import { BigNumber } from 'ethers'

import { JsonRpcProvider } from '@ethersproject/providers'
import Debug from 'debug'

import { PreVerificationGasCalculator, PreVerificationGasCalculatorConfig } from '@account-abstraction/sdk'

import {
  AddressZero,
  CodeHashGetter__factory,
  EIP7702Authorization,
  IEntryPoint,
  IEntryPointSimulations__factory,
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
  getEip7702AuthorizationSigner,
  mergeValidationDataValues,
  packUserOp,
  requireAddressAndFields,
  requireCond,
  runContractScript, getAuthorizationList, SenderCreator__factory, IEntryPoint__factory, IPaymaster__factory
} from '@account-abstraction/utils'

import { bundlerCollectorTracer, BundlerTracerResult, ExitInfo } from './BundlerCollectorTracer'
import { debug_traceCall } from './GethTracer'

import EntryPointSimulationsJson from '@account-abstraction/contracts/artifacts/EntryPointSimulations.json'
import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { Interface } from 'ethers/lib/utils'
import { ERC7562Parser } from './ERC7562Parser'
import { validateERC7562Call } from './ERC7562Call'

const debug = Debug('aa.mgr.validate')

// how much time into the future a UserOperation must be valid in order to be accepted
const VALID_UNTIL_FUTURE_SECONDS = 30

const HEX_REGEX = /^0x[a-fA-F\d]*$/i
const entryPointSimulations = IEntryPointSimulations__factory.createInterface()

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
      const simulationResult = await this.provider.send('eth_call', [tx, 'latest', stateOverride])
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

  async _geth_traceCall_SimulateValidation (
    operation: OperationBase,
    stateOverride: { [address: string]: { code: string } }
  ): Promise<[ValidationResult, BundlerTracerResult]> {
    const userOp = operation as UserOperation
    const provider = this.entryPoint.provider as JsonRpcProvider
    const simulateCall = entryPointSimulations.encodeFunctionData('simulateValidation', [packUserOp(userOp)])

    const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

    const stateOverrides = {
      [this.entryPoint.address]: {
        code: EntryPointSimulationsJson.deployedBytecode
      },
      ...stateOverride
    }
    let tracer
    if (!this.usingErc7562NativeTracer()) {
      tracer = bundlerCollectorTracer
    }
    const tracerResult = await debug_traceCall(provider, {
      from: AddressZero,
      to: this.entryPoint.address,
      data: simulateCall,
      gasLimit: simulationGas
    }, {
      tracer,
      stateOverrides
    },
    this.providerForTracer
    )

    let data: any
    if (!this.usingErc7562NativeTracer()) {
      // Using preState tracer + JS tracer
      const lastResult = tracerResult.calls.slice(-1)[0]
      data = (lastResult as ExitInfo).data
      if (lastResult.type === 'REVERT') {
        throw new RpcError(decodeRevertReason(data, false) as string, ValidationErrors.SimulateValidation)
      }
    } else {
      // Using Native tracer
      data = tracerResult.output
      if (tracerResult.error != null && (tracerResult.error as string).includes('execution reverted')) {
        throw new RpcError(decodeRevertReason(data, false) as string, ValidationErrors.SimulateValidation)
      }
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
      let tracerResult: BundlerTracerResult
      [res, tracerResult] = await this._geth_traceCall_SimulateValidation(userOp, stateOverrideForEip7702).catch(e => {
        throw e
      })
      // console.log('validation res', res)
      // todo fix
      if (this.usingErc7562NativeTracer()) {
        this.convertTracerResult(tracerResult, userOp)
      }
      // console.log('tracer res')
      // console.dir(tracerResult, { depth: null })
      let contractAddresses: string[]
      ({ contractAddresses, storageMap } = this.erc7562Parser.requireCompliance(userOp, tracerResult, res))
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

  // todo fix rest of the code to work with the new tracer result instead of adjusting it here
  convertTracerResult (tracerResult: any, userOp: UserOperation): BundlerTracerResult {
    validateERC7562Call(tracerResult)
    const SENDER_CREATOR = '0xefc2c1444ebcc4db75e7613d20c6a62ff67a167c'.toLowerCase()
    // Before flattening we add top level addresses for calls from EntryPoint and from SENDER_CREATOR
    tracerResult.calls.forEach((call: { calls: any, to: any, topLevelTargetAddress: any }) => {
      call.topLevelTargetAddress = call.to
      if (call.to.toLowerCase() === SENDER_CREATOR && call.calls != null) {
        call.calls.forEach((subcall: any) => {
          subcall.topLevelTargetAddress = subcall.to
        })
      }
    })
    tracerResult.calls = this.flattenCalls(tracerResult.calls)
    tracerResult.calls.forEach((call: {
      topLevelTargetAddress: any
      method: any
      input: any
      to: any
      from: any
      opcodes: any
      usedOpcodes: any
      access: any
      accessedSlots: any
      extCodeAccessInfo: any
      outOfGas: any
      oog: any
    }) => {
      call.opcodes = {}
      if (call.usedOpcodes != null) {
        Object.keys(call.usedOpcodes).forEach((opcode: string) => {
          call.opcodes[this.getOpcodeName(parseInt(opcode))] = call.usedOpcodes[opcode]
        })
      }

      if (call.access == null) {
        call.access = {}
      }
      if (call.accessedSlots != null) {
        call.access[call.to] = {
          reads: call.accessedSlots.reads ?? {},
          writes: call.accessedSlots.writes ?? {},
          transientReads: call.accessedSlots.transientReads ?? {},
          transientWrites: call.accessedSlots.transientWrites ?? {}
        }
        Object.keys(call.access[call.to].reads).forEach((slot) => {
          if (call.access[call.to].reads[slot] != null && call.access[call.to].reads[slot].length > 0) {
            call.access[call.to].reads[slot] = call.access[call.to].reads[slot][0]
          }
        })
      }
      if (call.extCodeAccessInfo == null) {
        call.extCodeAccessInfo = {}
      }
      const newExtCode: any = {}
      if (Array.isArray(call.extCodeAccessInfo)) {
        call.extCodeAccessInfo.forEach((addr: any) => {
          newExtCode[addr] = 1
        })
      }
      call.extCodeAccessInfo = newExtCode
      call.oog = call.outOfGas

      // Adding method name
      if (call.topLevelTargetAddress == null && call.to.toLowerCase() === this.entryPoint.address.toLowerCase()) {
        if (call.input.length <= 2) {
          call.method = '0x'
        } else {
          const mergedAbi = Object.values([
            ...SenderCreator__factory.abi,
            ...IEntryPoint__factory.abi,
            ...IPaymaster__factory.abi
          ].reduce((set, entry) => {
            const key = `${entry.name}(${entry.inputs.map(i => i.type).join(',')})`
            // console.log('key=', key, keccak256(Buffer.from(key)).slice(0,10))
            return {
              ...set,
              [key]: entry
            }
          }, {})) as any
          const AbiInterfaces = new Interface(mergedAbi)

          function callCatch<T, T1> (x: () => T, def: T1): T | T1 {
            try {
              return x()
            } catch {
              return def
            }
          }

          const methodSig = call.input.slice(0, 10)
          const method = callCatch(() => AbiInterfaces.getFunction(methodSig), methodSig)
          call.method = method.name
        }
      }
    })
    // TODO: This is a hardcoded address of SenderCreator immutable member in EntryPoint. Any change in EntryPoint's code
    //  requires a change of this address.
    // TODO check why the filter fails test_ban_user_op_access_other_ops_sender_in_bundle
    tracerResult.callsFromEntryPoint = tracerResult.calls // .filter((call: { from: string }) => call.from.toLowerCase() === this.entryPoint.address.toLowerCase() || call.from.toLowerCase() === SENDER_CREATOR)

    return tracerResult
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
}
