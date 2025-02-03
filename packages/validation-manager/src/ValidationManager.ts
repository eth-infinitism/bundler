import { BigNumber } from 'ethers'

import { JsonRpcProvider } from '@ethersproject/providers'
import Debug from 'debug'

import { PreVerificationGasCalculator, PreVerificationGasCalculatorConfig } from '@account-abstraction/sdk'

import {
  AddressZero,
  CodeHashGetter__factory,
  EIP7702Authorization,
  IEntryPoint,
  OperationBase,
  ReferencedCodeHashes,
  RpcError,
  StakeInfo,
  StakeInfoStructOutput,
  StorageMap,
  UserOperation,
  ValidationErrors,
  ValidationResultStructOutput,
  decodeErrorReason,
  decodeRevertReason,
  getAddr,
  getAuthorizationList,
  getEip7702AuthorizationSigner,
  mergeValidationDataValues,
  packUserOp,
  requireAddressAndFields,
  requireCond,
  runContractScript,
  PackedUserOperation,
  sum,
  IAccount__factory,
  parseValidationData,
  ValidationData,
  IPaymaster__factory, maxUint48
} from '@account-abstraction/utils'

import { debug_traceCall } from './GethTracer'

import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { ERC7562Parser } from './ERC7562Parser'
import { ERC7562Call } from './ERC7562Call'
import { bundlerCollectorTracer, BundlerTracerResult } from './BundlerCollectorTracer'
import { tracerResultParser } from './TracerResultParser'
import { GetStakes__factory } from '@account-abstraction/utils/dist/src/types'

const debug = Debug('aa.mgr.validate')

// how much time into the future a UserOperation must be valid in order to be accepted
const VALID_UNTIL_FUTURE_SECONDS = 30

const HEX_REGEX = /^0x[a-fA-F\d]*$/i

/**
 * ValidationManager is responsible for validating UserOperations.
 * @param entryPoint - the entryPoint contract
 * @param unsafe - if true, skip tracer for validation rules (validate only through eth_call)
 * @param preVerificationGasCalculator - helper to calculate the correct 'preVerificationGas' for the current network conditions
 * @param providerForTracer - if provided, use it for native bundlerCollectorTracer, and use main provider with "preStateTracer"
 *  (relevant only if unsafe=false)
 */
export class ValidationManager implements IValidationManager {
  private readonly provider: JsonRpcProvider

  constructor (
    readonly entryPoint: IEntryPoint,
    readonly unsafe: boolean,
    readonly preVerificationGasCalculator: PreVerificationGasCalculator,
    readonly erc7562Parser: ERC7562Parser,
    readonly providerForTracer?: JsonRpcProvider
  ) {
    this.provider = this.entryPoint.provider as JsonRpcProvider
  }

  _getDebugConfiguration (): {
    configuration: PreVerificationGasCalculatorConfig
    entryPoint: IEntryPoint
    unsafe: boolean
  } {
    return {
      configuration: this.preVerificationGasCalculator.config,
      entryPoint: this.entryPoint,
      unsafe: this.unsafe
    }
  }

  // generate validation result from trace: by decoding inner calls.
  async generateValidationResult (op: UserOperation, tracerResult: ERC7562Call): Promise<ValidationResult> {
    // const validationData = tracerResult.calls[0].output
    let callIndex = 0
    if (op.factory != null) {
      callIndex++
    }
    if (tracerResult.calls[callIndex] == null) {
      console.log('fatal: no validateuserop')
    }

    const validationData = this.decodeValidateUserOp(tracerResult.calls[callIndex])
    const aggregator = validationData.aggregator
    let paymasterValidationData: ValidationData = { validAfter: 0, validUntil: maxUint48, aggregator: AddressZero }
    let paymasterContext: string | undefined
    if (op.paymaster != null) {
      callIndex++
      const pmRet = this.decodeValidatePaymasterUserOp(tracerResult.calls[callIndex])
      paymasterContext = pmRet.context
      paymasterValidationData = pmRet.validationData
    }

    // todo: paymasterContext should be returned to parser, to validate its length.

    const paymasterAddress = op.paymaster ?? AddressZero
    const factoryAddress = op.factory ?? AddressZero
    const addrs = [op.sender, paymasterAddress, factoryAddress, aggregator]
    const retStakes = (await runContractScript(this.provider, new GetStakes__factory(), [this.entryPoint.address, addrs]))[0]

    const ret: ValidationResult = {
      returnInfo: {
        sigFailed: false, // can't fail here, since handleOps didn't revert.
        validUntil: Math.min(validationData.validUntil, paymasterValidationData.validUntil),
        validAfter: Math.max(validationData.validAfter, paymasterValidationData.validAfter),
        preOpGas: 0, // extract from innerHandleOps parameter
        prefund: 0 // extract from innerHandleOps parameter
      },
      senderInfo: retStakes[0]
    }
    if (op.paymaster !== null) {
      ret.paymasterInfo = retStakes[1]
    }
    if (op.factory !== null) {
      ret.factoryInfo = retStakes[2]
    }
    if (aggregator !== AddressZero) {
      ret.aggregatorInfo = retStakes[3]
    }
    return ret
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

  allOnes = '0x'.padEnd(66, 'f')

  // a "flag" UserOperation that triggers "AA94" revert error (not even FailedOp)
  eolUserOp: PackedUserOperation = {
    sender: AddressZero,
    nonce: 0,
    initCode: '0x',
    callData: '0x',
    accountGasLimits: this.allOnes,
    preVerificationGas: 0,
    gasFees: this.allOnes,
    paymasterAndData: '0x',
    signature: '0x'
  }

  // standard eth_call to simulateValidation
  async _callSimulateValidation (userOp: UserOperation): Promise<void> {
    // Promise<IEntryPointSimulations.ValidationResultStructOutput> {
    const data = this.entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userOp), this.eolUserOp], AddressZero])
    const tx = {
      to: this.entryPoint.address,
      data
    }

    try {
      await this.provider.send('eth_call', [tx, 'latest'])
    } catch (error: any) {
      const decodedError = decodeRevertReason(error)

      if (decodedError != null) {
        if (decodedError.startsWith('FailedOp(1,"AA94 gas values overflow')) {
          // this is not an error.. it is a marker the UserOp-under-test passed successfully
          return
        }
        throw new RpcError(decodedError, ValidationErrors.SimulateValidation)
      }
      throw error
    }
  }

  // decode and throw error
  _throwError (errorResult: { errorName: string, errorArgs: any }): never {
    throw new Error(errorResult.errorName)
  }

  async _geth_traceCall_SimulateValidation (
    operation: OperationBase,
    stateOverride: { [address: string]: { code: string } }
  ): Promise<[ValidationResult, ERC7562Call | null, BundlerTracerResult | null]> {
    const userOp = operation as UserOperation
    const provider = this.entryPoint.provider as JsonRpcProvider
    const handleOpsData = this.entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userOp), this.eolUserOp], AddressZero])

    const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

    // const stateOverrides = {
    //   // [this.entryPoint.address]: {
    //   //   code: EntryPointSimulationsJson.deployedBytecode
    //   // },
    //   ...stateOverride
    // }
    //
    // // validate against a future time: the UserOp must be valid at that time to be included
    // const blockOverrides = {
    //   time: '0x' + (Math.floor(Date.now() / 1000) + VALID_UNTIL_FUTURE_SECONDS).toString(16)
    // }

    let tracer
    if (!this.usingErc7562NativeTracer()) {
      tracer = bundlerCollectorTracer
    }
    const tracerResult = await debug_traceCall(provider, {
      from: AddressZero,
      to: this.entryPoint.address,
      data: handleOpsData,
      gasLimit: simulationGas
    }, {
      tracer
      // stateOverrides,
      // blockOverrides
    },
    this.providerForTracer
    )

    let data: any
    if (!this.usingErc7562NativeTracer()) {
      // Using preState tracer + JS tracer
      const lastResult = tracerResult.calls.slice(-1)[0]
      data = (lastResult).data
      if (lastResult.type === 'REVERT') {
        throw new RpcError(decodeRevertReason(data, false) as string, ValidationErrors.SimulateValidation)
      }
    } else {
      // Using Native tracer
      const decodedErrorReason = decodeRevertReason(tracerResult.output, false) as string
      if (decodedErrorReason !== 'FailedOp(1,"AA94 gas values overflow")') {
        throw new RpcError(decodedErrorReason, ValidationErrors.SimulateValidation)
      }
    }
    // // Hack to handle SELFDESTRUCT until we fix entrypoint
    // if (data === '0x') {
    //   return [data as any, tracerResult]
    // }
    try {
      // const [decodedSimulations] = entryPointSimulations.decodeFunctionResult('simulateValidation', data)
      // const validationResult = this.parseValidationResult(userOp, decodedSimulations)

      const validationResult = await this.generateValidationResult(userOp, tracerResult as ERC7562Call)
      debug('==dump tree=', JSON.stringify(tracerResult, null, 2)
        .replace(new RegExp(userOp.sender.toLowerCase()), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymaster) ?? '--no-paymaster--'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.factory) ?? '--no-initcode--'), '{factory}')
      )
      // console.log('==debug=', ...tracerResult.numberLevels.forEach(x=>x.access), 'sender=', userOp.sender, 'paymaster=', hexlify(userOp.paymasterAndData)?.slice(0, 42))
      // errorResult is "ValidationResult"
      if (this.usingErc7562NativeTracer()) {
        return [validationResult, tracerResult, null]
      } else {
        return [validationResult, null, tracerResult as BundlerTracerResult]
      }
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
   * should also handle unmodified memory, e.g. by referencing cached storage in the mempool
   * one item to check that was un-modified is the aggregator.
   * @param operation
   * @param previousCodeHashes
   * @param checkStakes
   */
  async validateUserOp (
    operation: OperationBase,
    previousCodeHashes?: ReferencedCodeHashes,
    checkStakes = true
  ): Promise<ValidateUserOpResult> {
    const userOp = operation as UserOperation
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
    const authorizationList = getAuthorizationList(userOp)
    if (authorizationList.length > 0) {
      // relevant only for RIP-7560...
      requireCond(authorizationList.length === 1, 'Only one authorization is supported', ValidationErrors.InvalidFields)

      const chainId = await this.provider.getNetwork().then(n => n.chainId)

      // list is required to be of size=1. for completeness, we still scan it as a list.
      for (const authorization of authorizationList) {
        const authChainId = BigNumber.from(authorization.chainId)
        requireCond(authChainId.eq(BigNumber.from(0)) ||
          authChainId.eq(chainId), 'Invalid chainId in authorization', ValidationErrors.InvalidFields)
        requireCond(getEip7702AuthorizationSigner(authorizationList[0]).toLowerCase() === userOp.sender.toLowerCase(), 'Authorization signer is not sender', ValidationErrors.InvalidFields)
      }
    }
    const stateOverrideForEip7702 = await this.getAuthorizationsStateOverride(authorizationList)
    let storageMap: StorageMap = {}
    if (!this.unsafe) {
      let erc7562Call: ERC7562Call | null
      let bundlerTracerResult: BundlerTracerResult | null
      [res, erc7562Call, bundlerTracerResult] = await this._geth_traceCall_SimulateValidation(userOp, stateOverrideForEip7702).catch(e => {
        throw e
      })
      // console.log('tracer res')
      // console.dir(tracerResult, { depth: null })
      let contractAddresses: string[]
      if (erc7562Call != null) {
        ({ contractAddresses, storageMap } = this.erc7562Parser.requireCompliance(userOp, erc7562Call, res))
      } else if (bundlerTracerResult != null) {
        [contractAddresses, storageMap] = tracerResultParser(userOp, bundlerTracerResult, res, this.entryPoint.address)
      } else {
        throw new Error('Tracer result is null for both legacy and modern parser')
      }
      // if no previous contract hashes, then calculate hashes of contracts
      if (previousCodeHashes == null) {
        codeHashes = await this.getCodeHashes(contractAddresses)
      }
      if (res as any === '0x') {
        throw new Error('simulateValidation reverted with no revert string!')
      }
    } else {
      // NOTE: this mode doesn't do any opcode checking and no stake checking!
      // can't decode validationResult at all. we only have "pass-or-not" result
      await this._callSimulateValidation(userOp)
      // dummy info: need tracer to decode (but it would revert on timerange, signature)
      res = {
        returnInfo: {
          // NOTE: this is an exageration. but we need simulation to calculate actual required preOpGas.
          preOpGas: sum(userOp.preVerificationGas, userOp.verificationGasLimit, userOp.paymasterVerificationGasLimit),
          sigFailed: false,
          validAfter: 0,
          validUntil: 0
        },
        senderInfo: {
          addr: userOp.sender,
          stake: '0',
          unstakeDelaySec: 0
        }
      }
    }

    requireCond(!res.returnInfo.sigFailed,
      'Invalid UserOp signature or paymaster signature',
      ValidationErrors.InvalidSignature)

    const now = Math.floor(Date.now() / 1000)
    requireCond(res.returnInfo.validAfter <= now,
      `time-range in the future time ${res.returnInfo.validAfter}, now=${now}`,
      ValidationErrors.NotInTimeRange)

    requireCond(res.returnInfo.validUntil === 0 || res.returnInfo.validUntil >= now,
      'already expired',
      ValidationErrors.NotInTimeRange)

    requireCond(res.returnInfo.validUntil === 0 || res.returnInfo.validUntil > now + VALID_UNTIL_FUTURE_SECONDS,
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

  async getAuthorizationsStateOverride (
    authorizations: EIP7702Authorization[] = []
  ): Promise<{ [address: string]: { code: string } }> {
    const stateOverride: { [address: string]: { code: string } } = {}
    for (const authorization of authorizations) {
      const authSigner = getEip7702AuthorizationSigner(authorization)
      const nonce = await this.provider.getTransactionCount(authSigner)
      const authNonce: any = authorization.nonce
      if (nonce !== BigNumber.from(authNonce.replace(/0x$/, '0x0')).toNumber()) {
        continue
      }
      const currentDelegateeCode = await this.provider.getCode(authSigner)
      const newDelegateeCode = await this.provider.getCode(authorization.address)
      // TODO should be: hexConcat(['0xef0100', authorization.address])
      const noCurrentDelegation = currentDelegateeCode.length <= 2
      // TODO: do not send such authorizations to 'handleOps' as it is a waste of gas
      const changeDelegation = newDelegateeCode !== currentDelegateeCode
      if (noCurrentDelegation || changeDelegation) {
        console.log('Adding state override:', { address: authSigner, code: newDelegateeCode.slice(0, 20) })
        stateOverride[authSigner] = {
          code: newDelegateeCode
        }
      }
    }
    return stateOverride
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
   * @param operation
   * @param entryPointInput
   * @param requireSignature
   * @param requireGasParams
   */
  validateInputParameters (
    operation: OperationBase,
    entryPointInput?: string,
    requireSignature = true, requireGasParams = true): void {
    requireCond(entryPointInput != null, 'No entryPoint param', ValidationErrors.InvalidFields)
    requireCond(entryPointInput?.toLowerCase() === this.entryPoint.address.toLowerCase(),
      `The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.entryPoint.address}`,
      ValidationErrors.InvalidFields)

    // minimal sanity check: userOp exists, and all members are hex
    requireCond(operation != null, 'No UserOperation param', ValidationErrors.InvalidFields)

    const fields = ['sender', 'nonce', 'callData']
    if (requireSignature) {
      fields.push('signature')
    }
    if (requireGasParams) {
      fields.push('preVerificationGas', 'verificationGasLimit', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas')
    }
    fields.forEach(key => {
      const value: string = (operation as any)[key]?.toString()
      requireCond(value != null,
        'Missing userOp field: ' + key + ' ' + JSON.stringify(operation),
        ValidationErrors.InvalidFields)
      requireCond(value.match(HEX_REGEX) != null,
        `Invalid hex value for property ${key}:${value} in UserOp`,
        ValidationErrors.InvalidFields)
    })

    requireAddressAndFields(operation, 'paymaster', ['paymasterPostOpGasLimit', 'paymasterVerificationGasLimit'], ['paymasterData'])
    requireAddressAndFields(operation, 'factory', ['factoryData'])

    const preVerificationGas = (operation as UserOperation).preVerificationGas
    if (preVerificationGas != null) {
      const { isPreVerificationGasValid, minRequiredPreVerificationGas } =
        this.preVerificationGasCalculator.validatePreVerificationGas(operation as UserOperation)
      requireCond(isPreVerificationGasValid,
        `preVerificationGas too low: expected at least ${minRequiredPreVerificationGas}, provided only ${parseInt(preVerificationGas as string)}`,
        ValidationErrors.InvalidFields)
    }
  }

  async getOperationHash (userOp: OperationBase): Promise<string> {
    return await this.entryPoint.getUserOpHash(packUserOp(userOp as UserOperation))
  }

  flattenCalls (calls: any[]): any[] {
    return calls.reduce((acc: any, call: any) => {
      acc.push(call) // Add the current call to the accumulator
      if (call.calls != null) {
        acc.push(...this.flattenCalls(call.calls)) // Recursively flatten the nested calls
      }
      return acc
    }, [])
  }

  getOpcodeName (opcodeNumber: number): string | number {
    const opcodeNames: { [key: number]: string } = {
      0x30: 'ADDRESS',
      0x31: 'BALANCE',
      0x32: 'ORIGIN',
      0x3A: 'GASPRICE',
      0x40: 'BLOCKHASH',
      0x41: 'COINBASE',
      0x42: 'TIMESTAMP',
      0x43: 'NUMBER',
      0x44: 'DIFFICULTY', // PREVRANDAO, RANDOM
      0x45: 'GASLIMIT',
      0x47: 'SELFBALANCE',
      0x48: 'BASEFEE',
      0x49: 'BLOBHASH',
      0x4A: 'BLOBBASEFEE',
      0x5A: 'GAS',
      0xF0: 'CREATE',
      0xFF: 'SELFDESTRUCT',
      0x3B: 'EXTCODESIZE',
      0x3C: 'EXTCODECOPY',
      0x3F: 'EXTCODEHASH',
      0x46: 'CHAINID',
      0x51: 'MLOAD',
      0x52: 'MSTORE',
      0x53: 'MSTORE8',
      0x54: 'SLOAD',
      0x55: 'SSTORE',
      0x5B: 'JUMPDEST',
      0x5C: 'TLOAD',
      0x5D: 'TSTORE',
      0x5E: 'MCOPY',
      0x5F: 'PUSH0',
      0xF1: 'CALL',
      0xF3: 'RETURN',
      0xF4: 'DELEGATECALL',
      0xF5: 'CREATE2',
      0xFA: 'STATICCALL',
      0xFD: 'REVERT',
      0xFE: 'INVALID'
    }
    return opcodeNames[opcodeNumber] ?? opcodeNumber
  }

  usingErc7562NativeTracer (): boolean {
    return this.providerForTracer == null
  }

  private decodeValidateUserOp (call: ERC7562Call): ValidationData {
    const iaccount = IAccount__factory.connect(call.to, this.provider)
    const methodSig = iaccount.interface.getSighash('validateUserOp')
    if (call.input.slice(0, 10) !== methodSig) {
      throw new Error('Not a validateUserOp')
    }
    if (call.output == null) {
      throw new Error('validateUserOp: No output')
    }
    return parseValidationData(call.output)
  }

  private decodeValidatePaymasterUserOp (call: ERC7562Call): { context: string, validationData: ValidationData } {
    const iPaymaster = IPaymaster__factory.connect(call.to, this.provider)
    const methodSig = iPaymaster.interface.getSighash('validatePaymasterUserOp')
    if (call.input.slice(0, 10) !== methodSig) {
      throw new Error('Not a validatePaymasterUserOp')
    }
    if (call.output == null) {
      throw new Error('validatePaymasterUserOp: No output')
    }
    const ret = iPaymaster.interface.decodeFunctionResult('validatePaymasterUserOp', call.output)
    return { context: ret.context, validationData: parseValidationData(ret.validationData) }
  }
}
