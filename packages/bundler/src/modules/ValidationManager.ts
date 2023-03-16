import { EntryPoint } from '@account-abstraction/contracts'
import { ReputationManager } from './ReputationManager'
import { BigNumber, BigNumberish, BytesLike, ethers } from 'ethers'
import { requireCond, RpcError } from '../utils'
import { AddressZero, decodeErrorReason } from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk'
import { parseScannerResult } from '../parseScannerResult'
import { JsonRpcProvider } from '@ethersproject/providers'
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo } from '../BundlerCollectorTracer'
import { debug_traceCall } from '../GethTracer'
import Debug from 'debug'
import { GetCodeHashes__factory } from '../types'
import { ReferencedCodeHashes, StakeInfo, StorageMap, UserOperation, ValidationErrors } from './Types'
import { getAddr, runContractScript } from './moduleUtils'

const debug = Debug('aa.mgr.validate')

/**
 * result from successful simulateValidation
 */
export interface ValidationResult {
  returnInfo: {
    preOpGas: BigNumberish
    prefund: BigNumberish
    sigFailed: boolean
    deadline: number
  }

  senderInfo: StakeInfo
  factoryInfo?: StakeInfo
  paymasterInfo?: StakeInfo
  aggregatorInfo?: StakeInfo
}

export interface ValidateUserOpResult extends ValidationResult {

  referencedContracts: ReferencedCodeHashes
  storageMap: StorageMap
}

const HEX_REGEX = /^0x[a-fA-F\d]*$/i

export class ValidationManager {
  constructor (
    readonly entryPoint: EntryPoint,
    readonly reputationManager: ReputationManager,
    readonly unsafe: boolean) {
  }

  // standard eth_call to simulateValidation
  async _callSimulateValidation (userOp: UserOperation): Promise<ValidationResult> {
    const errorResult = await this.entryPoint.callStatic.simulateValidation(userOp, { gasLimit: 10e6 }).catch(e => e)
    return this._parseErrorResult(userOp, errorResult)
  }

  _parseErrorResult (userOp: UserOperation, errorResult: { errorName: string, errorArgs: any }): ValidationResult {
    if (!errorResult?.errorName?.startsWith('ValidationResult')) {
      // parse it as FailedOp
      // if its FailedOp, then we have the paymaster param... otherwise its an Error(string)
      let paymaster = errorResult.errorArgs.paymaster
      if (paymaster === AddressZero) {
        paymaster = undefined
      }
      // eslint-disable-next-line
      const msg: string = errorResult.errorArgs?.reason ?? errorResult.toString()

      if (paymaster == null) {
        throw new RpcError(`account validation failed: ${msg}`, ValidationErrors.SimulateValidation)
      } else {
        throw new RpcError(`paymaster validation failed: ${msg}`, ValidationErrors.SimulatePaymasterValidation, { paymaster })
      }
    }

    const {
      returnInfo,
      senderInfo,
      factoryInfo,
      paymasterInfo,
      aggregatorInfo // may be missing (exists only SimulationResultWithAggregator
    } = errorResult.errorArgs

    // extract address from "data" (first 20 bytes)
    // add it as "addr" member to the "stakeinfo" struct
    // if no address, then return "undefined" instead of struct.
    function fillEntity (data: BytesLike, info: StakeInfo): StakeInfo | undefined {
      const addr = getAddr(data)
      return addr == null
        ? undefined
        : {
            ...info,
            addr
          }
    }

    return {
      returnInfo,
      senderInfo: {
        ...senderInfo,
        addr: userOp.sender
      },
      factoryInfo: fillEntity(userOp.initCode, factoryInfo),
      paymasterInfo: fillEntity(userOp.paymasterAndData, paymasterInfo),
      aggregatorInfo: fillEntity(aggregatorInfo?.actualAggregator, aggregatorInfo?.stakeInfo)
    }
  }

  async _geth_traceCall_SimulateValidation (userOp: UserOperation): Promise<[ValidationResult, BundlerCollectorReturn]> {
    const provider = this.entryPoint.provider as JsonRpcProvider
    const simulateCall = this.entryPoint.interface.encodeFunctionData('simulateValidation', [userOp])

    const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

    const tracerResult: BundlerCollectorReturn = await debug_traceCall(provider, {
      from: ethers.constants.AddressZero,
      to: this.entryPoint.address,
      data: simulateCall,
      gasLimit: simulationGas
    }, { tracer: bundlerCollectorTracer })

    const lastResult = tracerResult.calls.slice(-1)[0]
    if (lastResult.type !== 'REVERT') {
      throw new Error('Invalid response. simulateCall must revert')
    }
    const data = (lastResult as ExitInfo).data
    // Hack to handle SELFDESTRUCT until we fix entrypoint
    if (data === '0x') {
      return [data as any, tracerResult]
    }
    try {
      const {
        name: errorName,
        args: errorArgs
      } = this.entryPoint.interface.parseError(data)
      const errFullName = `${errorName}(${errorArgs.toString()})`
      const errorResult = this._parseErrorResult(userOp, {
        errorName,
        errorArgs
      })
      if (!errorName.includes('Result')) {
        // a real error, not a result.
        throw new Error(errFullName)
      }
      debug('==dump tree=', JSON.stringify(tracerResult, null, 2)
        .replace(new RegExp(userOp.sender.toLowerCase()), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymasterAndData) ?? '--no-paymaster--'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.initCode) ?? '--no-initcode--'), '{factory}')
      )
      // console.log('==debug=', ...tracerResult.numberLevels.forEach(x=>x.access), 'sender=', userOp.sender, 'paymaster=', hexlify(userOp.paymasterAndData)?.slice(0, 42))
      // errorResult is "ValidationResult"
      return [errorResult, tracerResult]
    } catch (e: any) {
      // if already parsed, throw as is
      if (e.code != null) {
        throw e
      }
      // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
      const err = decodeErrorReason(data)
      throw new RpcError(err != null ? err.message : data, 111)
    }
  }

  /**
   * validate UserOperation.
   * should also handle unmodified memory (e.g. by referencing cached storage in the mempool
   * one item to check that was un-modified is the aggregator..
   * @param userOp
   */
  async validateUserOp (userOp: UserOperation, previousCodeHashes?: ReferencedCodeHashes, checkStakes = true): Promise<ValidateUserOpResult> {
    if (previousCodeHashes != null && previousCodeHashes.addresses.length > 0) {
      const { hash: codeHashes } = await this.getCodeHashes(previousCodeHashes.addresses)
      requireCond(codeHashes === previousCodeHashes.hash,
        'modified code after first validation',
        ValidationErrors.OpcodeValidation)
    }
    let res: ValidationResult
    let codeHashes: ReferencedCodeHashes = {
      addresses: [],
      hash: ''
    }
    let storageMap: StorageMap = {}
    if (!this.unsafe) {
      let tracerResult: BundlerCollectorReturn
      [res, tracerResult] = await this._geth_traceCall_SimulateValidation(userOp)
      let contractAddresses: string[]
      [contractAddresses, storageMap] = parseScannerResult(userOp, tracerResult, res, this.entryPoint)
      // if no previous contract hashes, then calculate hashes of contracts
      if (previousCodeHashes == null) {
        codeHashes = await this.getCodeHashes(contractAddresses)
      }
      if (res as any === '0x') {
        throw new Error('simulateValidation reverted with no revert string!')
      }
    } else {
      // NOTE: this mode doesn't do any opcode checking and no stake checking!
      res = await this._callSimulateValidation(userOp)
    }

    requireCond(!res.returnInfo.sigFailed,
      'Invalid UserOp signature or paymaster signature',
      ValidationErrors.InvalidSignature)

    requireCond(res.returnInfo.deadline == null || res.returnInfo.deadline + 30 < Date.now() / 1000,
      'expires too soon',
      ValidationErrors.ExpiresShortly)

    if (res.aggregatorInfo != null) {
      this.reputationManager.checkStake('aggregator', res.aggregatorInfo)
    }

    requireCond(res.aggregatorInfo == null,
      'Currently not supporting aggregator',
      ValidationErrors.UnsupportedSignatureAggregator)

    return {
      ...res,
      referencedContracts: codeHashes,
      storageMap
    }
  }

  async getCodeHashes (addresses: string[]): Promise<ReferencedCodeHashes> {
    const { hash } = await runContractScript(
      this.entryPoint.provider,
      new GetCodeHashes__factory(),
      [addresses]
    )

    return {
      hash,
      addresses
    }
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
    requireCond(entryPointInput.toLowerCase() === this.entryPoint.address.toLowerCase(),
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
      requireCond(value != null,
        'Missing userOp field: ' + key + ' ' + JSON.stringify(userOp),
        ValidationErrors.InvalidFields)
      requireCond(value.match(HEX_REGEX) != null,
        `Invalid hex value for property ${key}:${value} in UserOp`,
        ValidationErrors.InvalidFields)
    })

    requireCond(userOp.paymasterAndData.length === 2 || userOp.paymasterAndData.length >= 42,
      'paymasterAndData: must contain at least an address',
      ValidationErrors.InvalidFields)

    // syntactically, initCode can be only the deployer address. but in reality, it must have calldata to uniquely identify the account
    requireCond(userOp.initCode.length === 2 || userOp.initCode.length >= 42,
      'initCode: must contain at least an address',
      ValidationErrors.InvalidFields)

    const calcPreVerificationGas1 = calcPreVerificationGas(userOp)
    requireCond(userOp.preVerificationGas >= calcPreVerificationGas1,
      `preVerificationGas too low: expected at least ${calcPreVerificationGas1}`,
      ValidationErrors.InvalidFields)
  }
}
