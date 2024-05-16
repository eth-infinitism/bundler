import { BigNumber, BigNumberish } from 'ethers'

import { JsonRpcProvider } from '@ethersproject/providers'
import Debug from 'debug'

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
  runContractScript,
  packUserOp,
  requireAddressAndFields,
  decodeRevertReason,
  mergeValidationDataValues,
  IEntryPointSimulations__factory,
  IEntryPoint,
  ValidationResultStructOutput,
  StakeInfoStructOutput
} from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk'

import { tracerResultParser } from './TracerResultParser'
import { BundlerTracerResult, bundlerCollectorTracer, ExitInfo } from './BundlerCollectorTracer'
import { debug_traceCall } from './GethTracer'

import EntryPointSimulationsJson from '@account-abstraction/contracts/artifacts/EntryPointSimulations.json'

const debug = Debug('aa.mgr.validate')

// how much time into the future a UserOperation must be valid in order to be accepted
const VALID_UNTIL_FUTURE_SECONDS = 30

/**
 * result from successful simulateValidation, after some parsing.
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
const entryPointSimulations = IEntryPointSimulations__factory.createInterface()

export class ValidationManager {
  constructor (
    readonly entryPoint: IEntryPoint,
    readonly unsafe: boolean
  ) {
  }

  parseValidationResult (userOp: UserOperation, res: ValidationResultStructOutput): ValidationResult {
    const mergedValidation = mergeValidationDataValues(res.returnInfo.accountValidationData, res.returnInfo.paymasterValidationData)

    function fillEntity (addr: string | undefined, info: StakeInfoStructOutput): StakeInfo | undefined {
      if (addr == null || addr === AddressZero) return undefined
      return {
        addr,
        stake: info.stake,
        unstakeDelaySec: info.unstakeDelaySec
      }
    }

    const returnInfo = {
      sigFailed: mergedValidation.aggregator !== AddressZero,
      validUntil: mergedValidation.validUntil,
      validAfter: mergedValidation.validAfter,
      preOpGas: res.returnInfo.preOpGas,
      prefund: res.returnInfo.prefund
    }
    return {
      returnInfo,
      senderInfo: fillEntity(userOp.sender, res.senderInfo) as StakeInfo,
      paymasterInfo: fillEntity(userOp.paymaster, res.paymasterInfo),
      factoryInfo: fillEntity(userOp.factory, res.factoryInfo),
      aggregatorInfo: fillEntity(res.aggregatorInfo.aggregator, res.aggregatorInfo.stakeInfo)
    }
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
      const [res] = entryPointSimulations.decodeFunctionResult('simulateValidation', simulationResult) as ValidationResultStructOutput[]

      return this.parseValidationResult(userOp, res)
    } catch (error: any) {
      const decodedError = decodeRevertReason(error)
      if (decodedError != null) {
        throw new RpcError(decodedError, ValidationErrors.SimulateValidation)
      }
      throw error
    }
  }

  // decode and throw error
  _throwError (errorResult: { errorName: string, errorArgs: any }): never {
    throw new Error(errorResult.errorName)
  }

  async _geth_traceCall_SimulateValidation (userOp: UserOperation): Promise<[ValidationResult, BundlerTracerResult]> {
    const provider = this.entryPoint.provider as JsonRpcProvider
    const simulateCall = entryPointSimulations.encodeFunctionData('simulateValidation', [packUserOp(userOp)])

    const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

    const tracerResult: BundlerTracerResult = await debug_traceCall(provider, {
      from: AddressZero,
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
      throw new RpcError(decodeRevertReason(data, false) as string, ValidationErrors.SimulateValidation)
    }
    // // Hack to handle SELFDESTRUCT until we fix entrypoint
    // if (data === '0x') {
    //   return [data as any, tracerResult]
    // }
    try {
      const [decodedSimulations] = entryPointSimulations.decodeFunctionResult('simulateValidation', data)
      const validationResult = this.parseValidationResult(userOp, decodedSimulations)

      debug('==dump tree=', JSON.stringify(tracerResult, null, 2)
        .replace(new RegExp(userOp.sender.toLowerCase()), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymaster) ?? '--no-paymaster--'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.factory) ?? '--no-initcode--'), '{factory}')
      )
      // console.log('==debug=', ...tracerResult.numberLevels.forEach(x=>x.access), 'sender=', userOp.sender, 'paymaster=', hexlify(userOp.paymasterAndData)?.slice(0, 42))
      // errorResult is "ValidationResult"
      return [validationResult, tracerResult]
    } catch (e: any) {
      // if already parsed, throw as is
      if (e.code != null) {
        throw e
      }
      // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
      const err = decodeErrorReason(e)
      throw new RpcError(err != null ? err.message : data, -32000)
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
      `time-range in the future time ${res.returnInfo.validAfter}, now=${now}`,
      ValidationErrors.NotInTimeRange)

    requireCond(res.returnInfo.validUntil == null || res.returnInfo.validUntil >= now,
      'already expired',
      ValidationErrors.NotInTimeRange)

    requireCond(res.returnInfo.validUntil == null || res.returnInfo.validUntil > now + VALID_UNTIL_FUTURE_SECONDS,
      'expires too soon',
      ValidationErrors.NotInTimeRange)

    requireCond(res.aggregatorInfo == null,
      'Currently not supporting aggregator',
      ValidationErrors.UnsupportedSignatureAggregator)

    const verificationCost = BigNumber.from(res.returnInfo.preOpGas).sub(userOp.preVerificationGas)
    const extraGas = BigNumber.from(userOp.verificationGasLimit).sub(verificationCost).toNumber()
    requireCond(extraGas >= 2000, `verificationGas should have extra 2000 gas. has only ${extraGas}`, ValidationErrors.SimulateValidation)

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
