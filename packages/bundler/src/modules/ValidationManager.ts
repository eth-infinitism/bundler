import { EntryPoint } from '@account-abstraction/contracts'
import { ReputationManager, ReputationStatus } from './ReputationManager'
import { BigNumber, BigNumberish } from 'ethers'
import { requireCond, RpcError } from '../utils'
import { getAddr, UserOperation } from './moduleUtils'
import { AddressZero } from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk'

export enum ValidationErrors {
  InvalidFields = -32602,
  SimulateValidation = -32500,
  SimulatePaymasterValidation = -32501,
  OpcodeValidation = -32502,
  ExpiresShortly = -32503,
  Reputation = -32504,
  InsufficientStake = -32505,
  UnsupportedSignatureAggregator = -32506
}

/**
 * result from successful simulateValidation
 */
export interface ValidationResult {
  preOpGas: BigNumberish,
  prefund: BigNumberish,
  // paymasterInfo exists only if there was a paymaster in the request
  paymasterInfo?: PaymasterInfo,
  // aggregatorInfo is filled only if the wallet has an aggregator.
  aggregatorInfo?: AggregationInfo
}

export interface AggregationInfo {
  actualAggregator: string
  aggregatorStake: BigNumberish
  aggregatorUnstakeDelay: BigNumberish
}

export interface PaymasterInfo {
  paymaster?: string //NOTE: filled locally from userOp. not received directly from validate
  paymasterStake: BigNumberish
  paymasterUnstakeDelay: BigNumber
}

const HEX_REGEX = /^0x[a-fA-F\d]*$/i

export class ValidationManager {
  constructor (
    readonly entryPoint: EntryPoint,
    readonly reputationManager: ReputationManager,
    readonly minStake: BigNumber,
    readonly minUnstakeDelay: number) {
  }

  /**
   * validate UserOperation.
   * should also handle unmodified memory (e.g. by referencing cached storage in the mempool
   * one item to check that was un-modified is the aggregator..
   * @param userOp
   */
  async validateUserOp (userOp: UserOperation): Promise<ValidationResult> {

    const paymaster = getAddr(userOp.paymasterAndData)
    const deployer = getAddr(userOp.initCode)

    await this._checkStake('paymaster', paymaster)
    await this._checkStake('deployer', deployer)

    //TODO: use traceCall
    const errorResult = await this.entryPoint.callStatic.simulateValidation(userOp).catch(e => e)
    if (!errorResult.errorName.startsWith('SimulationResult')) {
      // if its FailedOp, then we have the paymaster..
      let paymaster = errorResult.errorArgs.paymaster
      if (paymaster == AddressZero) {
        paymaster = undefined
      }
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

    if (paymaster != null) {
      paymasterInfo.paymaster = paymaster
    } else {
      paymasterInfo = undefined
    }

    requireCond(deadline + 30 < Date.now() / 1000,
      'expires too soon',
      ValidationErrors.ExpiresShortly)

    await this._checkStake('aggregator', aggregatorInfo.actualAggregator)

    requireCond(aggregatorInfo != null,
      'Currently not supporting aggregator',
      ValidationErrors.UnsupportedSignatureAggregator)

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

  /**
   * check the given address (paymaster/deployer/aggregator) is staked
   * @param addr
   */
  async _checkStake (title: 'paymaster' | 'aggregator' | 'deployer', addr?: string) {
    if (addr == null) {
      return
    }
    requireCond(this.reputationManager.getStatus(addr) !== ReputationStatus.BANNED,
      `${title} ${addr} is banned`, ValidationErrors.Reputation, { [title]: addr })

    const info = await this.entryPoint.getDepositInfo(addr)
    requireCond(info.stake.gte(this.minStake),
      `${title} ${addr} stake ${info.stake.toString()} is too low (min=${this.minStake})`, ValidationErrors.InsufficientStake)
    requireCond(info.unstakeDelaySec > this.minUnstakeDelay,
      `${title} ${addr} unstake delay ${info.unstakeDelaySec} is too low (min=${this.minUnstakeDelay})`, ValidationErrors.InsufficientStake)
  }

  /**
   * perform static checking on input parameters.
   * @param userOp
   * @param entryPointInput
   * @param requireSignature
   * @param requireGasParams
   */
  validateInputParameters (userOp: UserOperation, entryPointInput: string, requireSignature = true, requireGasParams = true): void {
    requireCond(entryPointInput != null, 'No entryPoint param', ValidationErrors.InvalidFields)
    requireCond(entryPointInput.toLowerCase() == this.entryPoint.address.toLowerCase(),
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
      requireCond(value != null, 'Missing userOp field: ' + key + ' ' + JSON.stringify(userOp), ValidationErrors.InvalidFields)
      requireCond(value.match(HEX_REGEX) != null, `Invalid hex value for property ${key}:${value} in UserOp`, ValidationErrors.InvalidFields)
    })

    requireCond(userOp.paymasterAndData.length == 2 || userOp.paymasterAndData.length >= 42,
      'paymasterAndData: must contain at least an address', ValidationErrors.InvalidFields)

    // syntactically, initCode can be only the deployer address. but in reality, it must have calldata to uniquely identify the account
    requireCond(userOp.initCode.length == 2 || userOp.initCode.length >= 42,
      'initCode: must contain at least an address', ValidationErrors.InvalidFields)

    let calcPreVerificationGas1 = calcPreVerificationGas(userOp)
    requireCond(userOp.preVerificationGas >= calcPreVerificationGas1,
      `preverificationGas too low: exected at least ${calcPreVerificationGas1}`,
      ValidationErrors.InvalidFields)
  }

}
