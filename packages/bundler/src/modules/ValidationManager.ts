import { EntryPoint, UserOperationStruct } from '@account-abstraction/contracts'
import { ReputationManager } from './ReputationManager'
import { BigNumber, BigNumberish } from 'ethers'
import { requireCond, RpcError } from '../utils'
import { getAddr, UserOperation } from './moduleUtils'
import { decodeErrorReason } from '@account-abstraction/utils'
import { resolveProperties } from 'ethers/lib/utils'

enum ValidationErrors {
  InvalidFields = -32602,
  SimulateValidation = -32500,
  SimulatePaymasterValidation = -32501,
  OpcodeValidation = -32502,
  ExpiresShortly = -32503,
  Reputation = -32504,
  InsufficientStake = -32505,
  UnsupportedSignatureAggregator = -32506
}

export interface ValidationResult {
  preOpGas: BigNumberish,
  prefund: BigNumberish,
  paymasterInfo?: PaymasterInfo,
  aggregatorInfo?: AggregationInfo
}

interface AggregationInfo {
  actualAggregator: string
  aggregatorStake: BigNumberish
  aggregatorUnstakeDelay: BigNumberish
}

interface PaymasterInfo {
  paymaster?: string //NOTE: filled locally from userOp. not received directly from validate
  paymasterStake: BigNumberish
  paymasterUnstakeDelay: BigNumber
}

const HEX_REGEX = /^0x[a-fA-F\d]*$/i
export class ValidationManager {
  constructor (readonly entryPoint: EntryPoint, readonly reputationManager: ReputationManager) {
  }

  /**
   * validate UserOperation.
   * should also handle unmodified memory (e.g. by referencing cached storage in the mempool
   * one item to check that was un-modified is the aggregator..
   * @param userOp
   */
  async validateUserOp (userOp: UserOperation): Promise<ValidationResult> {

    //TODO: use traceCall
    const errorResult = await this.entryPoint.callStatic.simulateValidation(userOp).catch(e => e)
    if (!errorResult.errorName.startsWith('SimulationResult')) {
      // if its FailedOp, then we have the paymaster..
      const paymaster = errorResult.errorArgs.paymaster
      let msg = errorResult.errorArgs.reason ?? errorResult.toString()
      let code = paymaster == null ?
        ValidationErrors.SimulateValidation :
        ValidationErrors.SimulatePaymasterValidation
      throw new RpcError(msg, code, { paymaster })
    }

    let {
      preOpGas,
      prefund,
      deadline,
      aggregatorInfo,
      paymasterInfo
    } = errorResult.errorArgs

    const paymaster = getAddr(userOp.paymasterAndData)
    if (paymaster != null) {
      paymasterInfo.paymaster = paymaster
    } else {
      paymasterInfo = undefined
    }

    requireCond(deadline + 30 < Date.now() / 1000, 'expires too soon', ValidationErrors.ExpiresShortly)

    //all validation logic (using trace, reputationManager)
    //extra data to keep in mempool (e.g. extcodehash)
    {
      return {
        preOpGas,
        prefund,
        paymasterInfo,
        aggregatorInfo
      }
    }
  }

  async _validateParameters (userOp: UserOperation, entryPointInput: string, requireSignature = true, requireGasParams = true): Promise<void> {
    requireCond(entryPointInput != null, 'No entryPoint param', ValidationErrors.InvalidFields)
    requireCond(entryPointInput.toLowerCase() == this.entryPoint.toLowerCase(),
      `The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.entryPoint.address}`,
      ValidationErrors.InvalidFields)

    // minimal sanity check: userOp exists, and all members are hex
    requireCond(userOp != null, 'No UserOperation param', ValidationErrors.InvalidFields)

    const fields = ['sender', 'nonce', 'initCode', 'callData', 'paymasterAndData']
    if (requireSignature) {
      fields.push('signature')
    }
    if (requireGasParams) {
      fields.push('preVerificationGas', 'verificationGasLimit', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas')
    }
    fields.forEach(key => {
      const value: string = (userOp as any)[key]?.toString()
      requireCond(value != null, 'Missing userOp field: ' + key + ' ' +JSON.stringify(userOp), ValidationErrors.InvalidFields)
      requireCond(value.match(HEX_REGEX) != null, `Invalid hex value for property ${key}:${value} in UserOp`, ValidationErrors.InvalidFields)
    })
  }

}
