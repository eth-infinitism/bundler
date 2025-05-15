import { BigNumber, BigNumberish } from 'ethers'

import { JsonRpcProvider } from '@ethersproject/providers'
import Debug from 'debug'

import { PreVerificationGasCalculator, PreVerificationGasCalculatorConfig } from '@account-abstraction/sdk'

import {
  AddressZero,
  CodeHashGetter__factory,
  EIP_7702_MARKER_INIT_CODE,
  EntryPoint__factory,
  IAccount__factory,
  IEntryPoint,
  IPaymaster__factory,
  OperationBase,
  ReferencedCodeHashes,
  RpcError,
  StakeInfo,
  StorageMap,
  UserOperation,
  ValidationData,
  ValidationErrors,
  callGetUserOpHashWithCode,
  decodeErrorReason,
  decodeRevertReason,
  getAddr,
  getAuthorizationList,
  getEip7702AuthorizationSigner,
  maxUint48,
  packUserOp,
  parseValidationData,
  requireAddressAndFields,
  requireCond,
  runContractScript,
  sum,
  PaymasterValidationInfo
} from '@account-abstraction/utils'

import { debug_traceCall } from './GethTracer'

import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { ERC7562Parser } from './ERC7562Parser'
import { ERC7562Call } from './ERC7562Call'
import { bundlerCollectorTracer, BundlerTracerResult } from './BundlerCollectorTracer'
import { tracerResultParser } from './TracerResultParser'
import { dumpCallTree, get4bytes } from './decodeHelper'

const debug = Debug('aa.mgr.validate')

// how much time into the future a UserOperation must be valid in order to be accepted
const VALID_UNTIL_FUTURE_SECONDS = 30

const HEX_REGEX = /^0x[a-fA-F\d]*$/i

// during simulation, we pass gas enough for simulation, and little extra.
// so either execution fails on OOG, (AA95) or the entire HandleOps fail on wrong beneficiary
// both mean validation success
const EXPECTED_INNER_HANDLE_OP_FAILURES = new Set([
  'FailedOp(0,"AA95 out of gas")',
  'Error(AA90 invalid beneficiary)'])

// maximum verification gas. used for preVerification gas calculation based on EIP-7623
const MAX_VERIFICATION_GAS_USED = 500_000

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

  async getStakes (sender: string, paymaster?: string, factory?: string): Promise<{
    sender: StakeInfo
    paymaster?: StakeInfo
    factory?: StakeInfo
  }> {
    const [senderInfo, paymasterInfo, factoryInfo] = await Promise.all([
      this.entryPoint.getDepositInfo(sender),
      paymaster != null ? this.entryPoint.getDepositInfo(paymaster) : null,
      factory != null && factory !== EIP_7702_MARKER_INIT_CODE ? this.entryPoint.getDepositInfo(factory) : null
    ])
    return {
      sender: { addr: sender, stake: senderInfo.stake, unstakeDelaySec: senderInfo.unstakeDelaySec },
      paymaster: paymasterInfo != null
        ? {
            addr: paymaster ?? '',
            stake: paymasterInfo.stake,
            unstakeDelaySec: paymasterInfo.unstakeDelaySec
          }
        : undefined,
      factory: factoryInfo != null
        ? {
            addr: factory ?? '',
            stake: factoryInfo.stake,
            unstakeDelaySec: factoryInfo.unstakeDelaySec
          }
        : undefined
    }
  }

  getValidationCalls (op: UserOperation, entryPointCall: ERC7562Call): {
    validationCall: ERC7562Call
    paymasterCall?: ERC7562Call
    innerCall: ERC7562Call
  } {
    let callIndex = 0
    const hasFactoryCall = op.factory != null && op.factory !== EIP_7702_MARKER_INIT_CODE
    const hasEip7702InitCall = op.factory === EIP_7702_MARKER_INIT_CODE && op.factoryData != null && op.factoryData.length > 0
    if (hasFactoryCall || hasEip7702InitCall) {
      callIndex++
    }
    const validationCall = entryPointCall.calls[callIndex++]
    let paymasterCall: ERC7562Call | undefined
    if (op.paymaster != null) {
      paymasterCall = entryPointCall.calls[callIndex++]
    }
    const innerCall = entryPointCall.calls[callIndex]
    return {
      validationCall,
      paymasterCall,
      innerCall
    }
  }

  // generate validation result from trace: by decoding inner calls.
  async generateValidationResult (op: UserOperation, tracerResult: ERC7562Call): Promise<ValidationResult> {
    const {
      validationCall,
      paymasterCall,
      innerCall
    } = this.getValidationCalls(op, tracerResult)

    if (debug.enabled) {
      // pass entrypoint and other addresses we want to resolve by name.
      const names = {
        ...op,
        ep: this.entryPoint.address,
        senderCreator: await this.entryPoint.senderCreator()
      }
      dumpCallTree(tracerResult, names)
    }

    const validationData = this.decodeValidateUserOp(validationCall)
    let paymasterValidationData: ValidationData = {
      validAfter: 0,
      validUntil: maxUint48,
      aggregator: AddressZero
    }
    let paymasterContext: string | undefined
    if (paymasterCall != null) {
      const pmRet = this.decodeValidatePaymasterUserOp(paymasterCall)
      paymasterContext = pmRet.context
      paymasterValidationData = pmRet.validationData
    }

    const innerHandleOpsOut = innerCall == null ? undefined : this.decodeInnerHandleOp(innerCall)
    const retStakes = await this.getStakes(op.sender, op.paymaster, op.factory)
    let paymasterInfo: PaymasterValidationInfo | undefined = retStakes.paymaster
    if (paymasterInfo != null) {
      paymasterInfo = {
        ...paymasterInfo,
        context: paymasterContext
      }
    }

    const ret: ValidationResult = {
      returnInfo: {
        sigFailed: false, // can't fail here, since handleOps didn't revert.
        validUntil: Math.min(validationData.validUntil, paymasterValidationData.validUntil),
        validAfter: Math.max(validationData.validAfter, paymasterValidationData.validAfter),
        preOpGas: innerHandleOpsOut?.preOpGas, // extract from innerHandleOps parameter
        prefund: innerHandleOpsOut?.prefund // extract from innerHandleOps parameter
      },
      senderInfo: retStakes.sender,
      paymasterInfo,
      factoryInfo: retStakes.factory
    }
    return ret
  }

  async _simulateHandleOps (userOp: UserOperation): Promise<void> {
    // build a batch with 2 UserOps: the one under test, and a "flag" UserOp that triggers "AA94" revert error,
    // and stops the validation.
    // That is, if we end up with FailedOp(1) with "AA94", it means the UserOp-under-test passed successfully.
    const data = this.entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userOp)], AddressZero])
    const prevg = this.preVerificationGasCalculator._calculate(userOp, {})
    const tx = {
      to: this.entryPoint.address,
      data,
      authorizationList: userOp.eip7702Auth == null ? null : [userOp.eip7702Auth],
      gas: sum(prevg, userOp.verificationGasLimit, userOp.paymasterVerificationGasLimit).toNumber()
    }

    try {
      await this.provider.send('eth_call', [tx, 'latest'])
    } catch (error: any) {
      const decodedError = decodeRevertReason(error)

      if (decodedError != null) {
        // throw with specific error codes:
        if (decodedError.startsWith('FailedOp(0,"AA24')) {
          throw new RpcError('AA24: Invalid UserOp signature', ValidationErrors.InvalidSignature)
        }
        if (decodedError.startsWith('FailedOp(0,"AA34')) {
          throw new RpcError('AA34: Invalid Paymaster signature', ValidationErrors.InvalidSignature)
        }

        if (EXPECTED_INNER_HANDLE_OP_FAILURES.has(decodedError)) {
          // this is not an error. it is a marker the UserOp-under-test passed successfully
          return
        }
        throw new RpcError(decodedError, ValidationErrors.SimulateValidation)
      }
      throw error
    }
  }

  async _geth_traceCall_SimulateValidation (
    operation: OperationBase,
    stateOverride: { [address: string]: { code: string } } = {}
  ): Promise<[ValidationResult, ERC7562Call | null, BundlerTracerResult | null]> {
    const userOp = operation as UserOperation
    const provider = this.entryPoint.provider as JsonRpcProvider
    const handleOpsData = this.entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userOp)], AddressZero])

    const prevg = this.preVerificationGasCalculator._calculate(userOp, {})

    // give simulation enough gas to run validations, but not more.
    // we don't trust the use-supplied preVerificaitonGas
    const simulationGas = sum(prevg, userOp.verificationGasLimit, userOp.paymasterVerificationGasLimit ?? 0)

    let tracer
    if (!this.usingErc7562NativeTracer()) {
      tracer = bundlerCollectorTracer
    }
    const tracerResult = await debug_traceCall(provider, {
      from: AddressZero,
      to: this.entryPoint.address,
      data: handleOpsData,
      gasLimit: simulationGas,
      authorizationList: userOp.eip7702Auth == null ? null : [userOp.eip7702Auth]
    } as any, {
      tracer,
      stateOverrides: stateOverride
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

      // throw with specific error codes:
      if (decodedErrorReason.startsWith('FailedOp(0,"AA24')) {
        throw new RpcError('AA24: Invalid UserOp signature', ValidationErrors.InvalidSignature)
      }
      if (decodedErrorReason.startsWith('FailedOp(0,"AA34')) {
        throw new RpcError('AA34: Invalid Paymaster signature', ValidationErrors.InvalidSignature)
      }

      if (!EXPECTED_INNER_HANDLE_OP_FAILURES.has(decodedErrorReason)) {
        throw new RpcError(decodedErrorReason, ValidationErrors.SimulateValidation)
      }
    }

    try {
      const validationResult = await this.generateValidationResult(userOp, tracerResult as ERC7562Call)
      debug('==dump tree=', JSON.stringify(tracerResult, null, 2)
        .replace(new RegExp(userOp.sender, 'i'), '{sender}')
        .replace(new RegExp(getAddr(userOp.paymaster) ?? '--no-paymaster--', 'i'), '{paymaster}')
        .replace(new RegExp(getAddr(userOp.factory) ?? '--no-initcode--', 'i'), '{factory}')
      )

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
      if (err == null) {
        console.log('ex=', e)
      }
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
    let storageMap: StorageMap = {}
    if (!this.unsafe) {
      let erc7562Call: ERC7562Call | null
      let bundlerTracerResult: BundlerTracerResult | null
      [res, erc7562Call, bundlerTracerResult] = await this._geth_traceCall_SimulateValidation(userOp).catch(e => {
        throw e
      })
      // console.log('tracer res')
      // console.dir(tracerResult, { depth: null })
      let contractAddresses: string[]
      if (erc7562Call != null) {
        ({
          contractAddresses,
          storageMap
        } = this.erc7562Parser.requireCompliance(userOp, erc7562Call, res))
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
      await this._simulateHandleOps(userOp)
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

    this.revalidatePreVerificationGas(userOp, res)
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

  revalidatePreVerificationGas (userOp: UserOperation, validationResult: ValidationResult): void {
    // re-validate preVerificationGas:
    // once we performed simulation, we should repeat the validation of preVerificationGas:
    // with EIP-7623, calldata cost is increased if actual gas usage is low.
    // For the first call to validatePreVerificationGas used a high validation gas,
    // but now we need to repeat the check, with actual validation gas used.

    const preVerificationGas = BigNumber.from(userOp.preVerificationGas).toNumber()
    const verificationGasUsed =
      BigNumber.from(validationResult.returnInfo.preOpGas).sub(preVerificationGas).toNumber()

    const {
      isPreVerificationGasValid,
      minRequiredPreVerificationGas
    } =
      this.preVerificationGasCalculator.validatePreVerificationGas(userOp, { verificationGasUsed })
    requireCond(isPreVerificationGasValid,
      `preVerificationGas too low: expected at least ${minRequiredPreVerificationGas}, provided only ${preVerificationGas}
      (verificationGas=${verificationGasUsed}, exec=${userOp.callGasLimit as unknown as string})`,
      ValidationErrors.InvalidFields)
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
    if (operation.factory !== EIP_7702_MARKER_INIT_CODE) {
      requireAddressAndFields(operation, 'factory', ['factoryData'])
    }
    const preVerificationGas = (operation as UserOperation).preVerificationGas
    if (preVerificationGas != null) {
      const {
        isPreVerificationGasValid,
        minRequiredPreVerificationGas
      } =
        this.preVerificationGasCalculator.validatePreVerificationGas(operation as UserOperation, { verificationGasUsed: MAX_VERIFICATION_GAS_USED })
      requireCond(isPreVerificationGasValid,
        `preVerificationGas too low: expected at least ${minRequiredPreVerificationGas}, provided only ${parseInt(preVerificationGas as string)}`,
        ValidationErrors.InvalidFields)
    }
  }

  async getOperationHash (userOp: OperationBase): Promise<string> {
    return await callGetUserOpHashWithCode(this.entryPoint, userOp as UserOperation)
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
    if (get4bytes(call.input) !== methodSig) {
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
    if (get4bytes(call.input) !== methodSig) {
      throw new Error('Not a validatePaymasterUserOp')
    }
    if (call.output == null) {
      throw new Error('validatePaymasterUserOp: No output')
    }
    const ret = iPaymaster.interface.decodeFunctionResult('validatePaymasterUserOp', call.output)
    return {
      context: ret.context,
      validationData: parseValidationData(ret.validationData)
    }
  }

  // decode inputs to innerHandleOp, and extract preOpGas, prefund
  private decodeInnerHandleOp (call: ERC7562Call): { preOpGas: BigNumberish, prefund: BigNumberish } {
    const entryPoint = EntryPoint__factory.connect(call.to, this.provider)
    const methodSig = entryPoint.interface.getSighash('innerHandleOp')
    if (get4bytes(call.input) !== methodSig) {
      throw new Error('Not a innerHandleOp')
    }
    const params = entryPoint.interface.decodeFunctionData('innerHandleOp', call.input)
    return {
      preOpGas: params.opInfo.preOpGas,
      prefund: params.opInfo.prefund
    }
  }
}
