import { BigNumber, BigNumberish, ethers } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import Debug from 'debug'

import { EntryPointSimulations__factory, IEntryPoint, IEntryPointSimulations } from '@account-abstraction/contracts'
import {
  AddressZero,
  CodeHashGetter__factory,
  ReferencedCodeHashes,
  RpcError,
  StakeInfo,
  StorageMap,
  UserOperation,
  ValidationErrors,
  decodeErrorReason,
  getAddr,
  requireCond,
  runContractScript, packUserOp, requireAddressAndFields
} from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk'

import { tracerResultParser } from './TracerResultParser'
import { BundlerTracerResult, bundlerCollectorTracer, ExitInfo } from './BundlerCollectorTracer'
import { debug_traceCall } from './GethTracer'

import EntryPointSimulationsJson from '@account-abstraction/contracts/artifacts/EntryPointSimulations.json'
import { decodeRevertReason } from '@account-abstraction/utils/dist/src/decodeRevertReason'

const debug = Debug('aa.mgr.validate')

// how much time into the future a UserOperation must be valid in order to be accepted
const VALID_UNTIL_FUTURE_SECONDS = 30

// extract address from "data" (first 20 bytes)
// add it as "addr" member to the "stakeinfo" struct
// if no address, then return "undefined" instead of struct.
function fillEntity (addr: string | undefined, info: StakeInfo): StakeInfo | undefined {
  return addr == null || addr === AddressZero || addr === ''
    ? undefined
    : {
        ...info,
        addr
      }
}

/**
 * result from successful simulateValidation
 */
export interface ValidationResult {
  returnInfo: {
    preOpGas: BigNumberish
    prefund: BigNumberish
    sigFailed: boolean
    validAfter: number
    validUntil: number
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
const entryPointSimulations = EntryPointSimulations__factory.createInterface()

export class ValidationManager {
  constructor (
    readonly entryPoint: IEntryPoint,
    readonly unsafe: boolean
  ) {
  }

  // standard eth_call to simulateValidation
  async _callSimulateValidation (userOp: UserOperation): Promise<ValidationResult> {
    // Promise<IEntryPointSimulations.ValidationResultStructOutput> {
    const data = entryPointSimulations.encodeFunctionData('simulateValidation', [packUserOp(userOp)])
    const tx = {
      to: this.entryPoint.address,
      data
    }
    const stateOverride = {
      [this.entryPoint.address]: {
        code: EntryPointSimulationsJson.deployedBytecode
      }
    }
    try {
      const provider = this.entryPoint.provider as JsonRpcProvider
      const simulationResult = await provider.send('eth_call', [tx, 'latest', stateOverride])
      const [res] = entryPointSimulations.decodeFunctionResult('simulateValidation', simulationResult) as IEntryPointSimulations.ValidationResultStructOutput[]
      return {
        returnInfo: res.returnInfo,
        senderInfo: { ...res.senderInfo, addr: userOp.sender },
        paymasterInfo: { ...res.paymasterInfo, addr: userOp.paymaster ?? '' },
        factoryInfo: { ...res.factoryInfo, addr: userOp.factory ?? '' },
        aggregatorInfo: res.aggregatorInfo.aggregator === AddressZero ? undefined : { ...res.aggregatorInfo.stakeInfo, addr: res.aggregatorInfo?.aggregator }
      }
    } catch (error: any) {
      const decodedError = decodeRevertReason(error)
      if (decodedError != null) {
        throw new Error(decodedError)
      }
      throw error
    }
  }

  // decode and throw error
  _throwError (errorResult: { errorName: string, errorArgs: any }): never {
    throw new Error(errorResult.errorName)
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

    return {
      returnInfo,
      senderInfo: {
        ...senderInfo,
        addr: userOp.sender
      },
      factoryInfo: fillEntity(userOp.factory, factoryInfo),
      paymasterInfo: fillEntity(userOp.paymaster, paymasterInfo),
      aggregatorInfo: fillEntity(aggregatorInfo?.actualAggregator, aggregatorInfo?.stakeInfo)
    }
  }

  async _geth_traceCall_SimulateValidation (userOp: UserOperation): Promise<[ValidationResult, BundlerTracerResult]> {
    const provider = this.entryPoint.provider as JsonRpcProvider
    const simulateCall = entryPointSimulations.encodeFunctionData('simulateValidation', [packUserOp(userOp)])

    const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

    const tracerResult: BundlerTracerResult = await debug_traceCall(provider, {
      from: ethers.constants.AddressZero,
      to: this.entryPoint.address,
      data: simulateCall,
      gasLimit: simulationGas
    }, {
      tracer: bundlerCollectorTracer,
      stateOverrides: {
        [this.entryPoint.address]: {
          code: EntryPointSimulationsJson.deployedBytecode
        }
      }
    })

    const lastResult = tracerResult.calls.slice(-1)[0]
    const data = (lastResult as ExitInfo).data
    if (lastResult.type === 'REVERT') {
      throw new Error(decodeRevertReason(data, false) as string)
    }
    // Hack to handle SELFDESTRUCT until we fix entrypoint
    if (data === '0x') {
      return [data as any, tracerResult]
    }
    try {
      const [decodedSimulations] = entryPointSimulations.decodeFunctionResult('simulateValidation', data)
      const validationResult = {
        returnInfo: decodedSimulations.returnInfo,
        senderInfo: {
          ...decodedSimulations.senderInfo,
          addr: userOp.sender
        },
        factoryInfo: fillEntity(userOp.factory ?? '', decodedSimulations.factoryInfo),
        paymasterInfo: fillEntity(userOp.paymaster ?? '', decodedSimulations.paymasterInfo),
        aggregatorInfo: fillEntity(decodedSimulations.aggregatorInfo.aggregator, decodedSimulations.aggregatorInfo.stakeInfo)
      }
      // const {
      //   name: errorName,
      //   args: errorArgs
      // } = this.entryPoint.interface.parseError(data)
      // const errFullName = `${errorName}(${errorArgs.toString()})`
      // const errorResult = this._parseErrorResult(userOp, {
      //   errorName,
      //   errorArgs
      // })
      // if (!errorName.includes('Result')) {
      //   // a real error, not a result.
      //   throw new Error(errFullName)
      // }
      debug('==dump tree=', JSON.stringify(tracerResult, null, 2)
        .replace(new RegExp(userOp.sender.toLowerCase()), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymaster) ?? '--no-paymaster--'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.factory) ?? '--no-initcode--'), '{factory}')
      )
      // console.log('==debug=', ...tracerResult.numberLevels.forEach(x=>x.access), 'sender=', userOp.sender, 'paymaster=', hexlify(userOp.paymasterAndData)?.slice(0, 42))
      // errorResult is "ValidationResult"
      return [validationResult as any, tracerResult]
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
      // [COD-010]
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
      let tracerResult: BundlerTracerResult
      [res, tracerResult] = await this._geth_traceCall_SimulateValidation(userOp).catch(e => {
        throw e
      })
      let contractAddresses: string[]
      [contractAddresses, storageMap] = tracerResultParser(userOp, tracerResult, res, this.entryPoint)
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

    const now = Math.floor(Date.now() / 1000)
    requireCond(res.returnInfo.validAfter <= now,
      'time-range in the future time',
      ValidationErrors.NotInTimeRange)

    console.log('until', res.returnInfo.validUntil, 'now=', now)
    requireCond(res.returnInfo.validUntil == null || res.returnInfo.validUntil >= now,
      'already expired',
      ValidationErrors.NotInTimeRange)

    requireCond(res.returnInfo.validUntil == null || res.returnInfo.validUntil > now + VALID_UNTIL_FUTURE_SECONDS,
      'expires too soon',
      ValidationErrors.NotInTimeRange)

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
      new CodeHashGetter__factory(),
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

    const fields = ['sender', 'nonce', 'callData']
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

    requireAddressAndFields(userOp, 'paymaster', ['paymasterPostOpGasLimit', 'paymasterVerificationGasLimit'], ['paymasterData'])
    requireAddressAndFields(userOp, 'factory', ['factoryData'])

    const calcPreVerificationGas1 = calcPreVerificationGas(userOp)
    requireCond(BigNumber.from(userOp.preVerificationGas).gte(calcPreVerificationGas1),
      `preVerificationGas too low: expected at least ${calcPreVerificationGas1}`,
      ValidationErrors.InvalidFields)
  }
}
