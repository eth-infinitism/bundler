import { EntryPoint } from '@account-abstraction/contracts'
import { ReputationManager, ReputationStatus } from './ReputationManager'
import { BigNumber, BigNumberish, ethers } from 'ethers'
import { requireCond, RpcError } from '../utils'
import { getAddr, UserOperation } from './moduleUtils'
import { AddressZero, decodeErrorReason } from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk'
import { isGeth, parseScannerResult } from '../opcodeScanner'
import { JsonRpcProvider } from '@ethersproject/providers'
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo } from '../BundlerCollectorTracer'
import { debug_traceCall } from '../GethTracer'
import Debug from 'debug'

const debug = Debug('mgr.validate')

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
  preOpGas: BigNumberish
  prefund: BigNumberish
  deadline: number
  // paymasterInfo exists only if there was a paymaster in the request
  paymasterInfo?: PaymasterInfo
  // aggregatorInfo is filled only if the wallet has an aggregator.
  aggregatorInfo?: AggregationInfo
}

export interface AggregationInfo {
  actualAggregator: string
  aggregatorStake: BigNumberish
  aggregatorUnstakeDelay: BigNumberish
}

export interface PaymasterInfo {
  paymaster?: string // NOTE: filled locally from userOp. not received directly from validate
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

  // standard eth_call to simulateValidation
  async _callSimulateValidation (userOp: UserOperation): Promise<ValidationResult> {
    const errorResult = await this.entryPoint.callStatic.simulateValidation(userOp).catch(e => e)
    return this._parseErrorResult(userOp, errorResult)
  }

  _parseErrorResult (userOp: UserOperation, errorResult: { name: string, args: any }): ValidationResult {
    if (!(errorResult?.name).startsWith('SimulationResult')) {
      console.log('non-result error: ', errorResult)
      // if its FailedOp, then we have the paymaster... otherwise its an Error(string)
      let paymaster = errorResult.args.paymaster
      if (paymaster === AddressZero) {
        paymaster = undefined
      }
      // eslint-disable-next-line
      const msg: string = errorResult.args.reason ?? errorResult.toString()
      if (paymaster == null) {
        throw new RpcError(`account validation failed: ${msg}`, ValidationErrors.SimulateValidation)
      } else {
        throw new RpcError(`paymaster validation failed: ${msg}`, ValidationErrors.SimulatePaymasterValidation)
      }
    }

    let {
      preOpGas,
      prefund,
      deadline,
      aggregatorInfo,
      paymasterInfo
    } = errorResult.args
    const paymaster = getAddr(userOp.paymasterAndData)

    if (paymaster != null) {
      paymasterInfo = {
        ...paymasterInfo,
        paymaster
      }
    } else {
      paymasterInfo = undefined
    }

    return {
      preOpGas,
      prefund,
      deadline,
      paymasterInfo,
      aggregatorInfo
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
    try {
      const {
        name,
        args
      } = this.entryPoint.interface.parseError(data)
      const errName = `${name}(${args.toString()})`
      const errorResult = this._parseErrorResult(userOp, {
        name,
        args
      })
      if (!name.includes('Result')) {
        // a real error, not a result.
        throw new Error(errName)
      }
      debug('==dump tree=', JSON.stringify(tracerResult,null,2)
        .replace(new RegExp(userOp.sender.toLowerCase()), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymasterAndData) ??'--no-paymaster--'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.initCode) ??'--no-initcode--'), '{factory}')
      )
      // console.log('==debug=', ...tracerResult.numberLevels.forEach(x=>x.access), 'sender=', userOp.sender, 'paymaster=', hexlify(userOp.paymasterAndData)?.slice(0, 42))
      return [errorResult, tracerResult]
    } catch (e: any) {
      // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
      const err = decodeErrorReason(data)
      throw new Error(err != null ? err.message : data)
    }
  }

  /**
   * validate UserOperation.
   * should also handle unmodified memory (e.g. by referencing cached storage in the mempool
   * one item to check that was un-modified is the aggregator..
   * @param userOp
   */
  async validateUserOp (userOp: UserOperation, checkStakes = true): Promise<ValidationResult> {
    const paymaster = getAddr(userOp.paymasterAndData)
    const deployer = getAddr(userOp.initCode)

    await this._checkStake('paymaster', paymaster)
    await this._checkStake('deployer', deployer)

    // TODO: use traceCall
    let res: ValidationResult
    if (await isGeth(this.entryPoint.provider as any)) {
      let tracerResult: BundlerCollectorReturn
      [res, tracerResult] = await this._geth_traceCall_SimulateValidation(userOp)
      parseScannerResult(userOp, tracerResult, this.entryPoint)
    } else {
      res = await this._callSimulateValidation(userOp)
    }

    requireCond(res.deadline + 30 < Date.now() / 1000,
      'expires too soon',
      ValidationErrors.ExpiresShortly)

    await this._checkStake('aggregator', res.aggregatorInfo?.actualAggregator)

    requireCond(res.aggregatorInfo == null,
      'Currently not supporting aggregator',
      ValidationErrors.UnsupportedSignatureAggregator)

    return res
  }

  /**
   * check the given address (paymaster/deployer/aggregator) is staked
   * @param title the address title (field name to put into the "data" element)
   * @param addr
   */
  async _checkStake (title: 'paymaster' | 'aggregator' | 'deployer', addr?: string): Promise<void> {
    if (addr == null || this.reputationManager.isWhitelisted(addr)) {
      return
    }
    requireCond(this.reputationManager.getStatus(addr) !== ReputationStatus.BANNED,
      `${title} ${addr} is banned`,
      ValidationErrors.Reputation, { [title]: addr })

    const info = await this.entryPoint.getDepositInfo(addr)
    requireCond(info.stake.gte(this.minStake),
      `${title} ${addr} stake ${info.stake.toString()} is too low (min=${this.minStake.toString()})`,
      ValidationErrors.InsufficientStake)
    requireCond(info.unstakeDelaySec >= this.minUnstakeDelay,
      `${title} ${addr} unstake delay ${info.unstakeDelaySec} is too low (min=${this.minUnstakeDelay})`,
      ValidationErrors.InsufficientStake)
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
