import { BigNumber, BigNumberish, ethers, Wallet } from 'ethers'
import { JsonRpcProvider, JsonRpcSigner, Provider } from '@ethersproject/providers'

import { BundlerConfig } from './BundlerConfig'
import { EntryPoint } from './types'
import { hexValue, resolveProperties } from 'ethers/lib/utils'
import { AddressZero, decodeErrorReason, deepHexlify, rethrowError } from '@account-abstraction/utils'
import { debug_traceCall } from './GethTracer'
import { BundlerCollectorReturn, bundlerCollectorTracer } from './BundlerCollectorTracer'
import { EntryPoint__factory, UserOperationStruct } from '@account-abstraction/contracts'
import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { calcPreVerificationGas } from '@account-abstraction/sdk'
import { replaceMethodSig, requireCond, RpcError } from './utils'
import Debug from 'debug'
import { boolean } from 'hardhat/internal/core/params/argumentTypes'

const debug = Debug('aa.handler.userop')

const HEX_REGEX = /^0x[a-fA-F\d]*$/i

/**
 * return value from estimateUserOpGas
 */
export interface EstimateUserOpGasResult {
  /**
   * the preVerification gas used by this UserOperation.
   */
  preVerificationGas: BigNumberish
  /**
   * gas used for validation of this UserOperation, including account creation
   */
  verificationGas: BigNumberish
  /**
   * the deadline after which this UserOperation is invalid (not a gas estimation parameter, but returned by validation
   */
  deadline?: BigNumberish
  /**
   * estimated cost of calling the account with the given callData
   */
  callGasLimit: BigNumberish
}

export interface CallUserOperationResult extends EstimateUserOpGasResult {

  /**
   * true/false whether this userOp execution succeeds
   */
  success: boolean

  /**
   * optional: in case the execution fails, attempt to return the revert reason code
   */
  reason?: string
}

export class UserOpMethodHandler {
  constructor (
    readonly provider: Provider,
    readonly signer: Wallet | JsonRpcSigner,
    readonly config: BundlerConfig,
    readonly entryPoint: EntryPoint
    // readonly bundlerHelper: BundlerHelper
  ) {
  }

  clientVersion?: string

  async isGeth (): Promise<boolean> {
    if (this.clientVersion == null) {
      this.clientVersion = await (this.provider as JsonRpcProvider).send('web3_clientVersion', [])
    }
    debug('client version', this.clientVersion)
    return this.clientVersion?.match('Geth') != null
  }

  async getSupportedEntryPoints (): Promise<string[]> {
    return [this.config.entryPoint]
  }

  async selectBeneficiary (): Promise<string> {
    const currentBalance = await this.provider.getBalance(this.signer.getAddress())
    let beneficiary = this.config.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.config.minBalance)) {
      beneficiary = await this.signer.getAddress()
      console.log('low balance. using ', beneficiary, 'as beneficiary instead of ', this.config.beneficiary)
    }
    return beneficiary
  }

  async _validateParameters (userOp1: UserOperationStruct, entryPointInput: string, requireSignature = true, requireGasParams = true): Promise<void> {
    requireCond(entryPointInput != null, 'No entryPoint param', -32602)

    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }

    // minimal sanity check: userOp exists, and all members are hex
    requireCond(userOp1 != null, 'No UserOperation param')
    const userOp = await resolveProperties(userOp1) as any

    const fields = ['sender', 'nonce', 'initCode', 'callData', 'paymasterAndData']
    if (requireSignature) {
      fields.push('signature')
    }
    if (requireGasParams) {
      fields.push('preVerificationGas', 'verificationGasLimit', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas')
    }
    fields.forEach(key => {
      requireCond(userOp[key] != null, 'Missing userOp field: ' + key + JSON.stringify(userOp), -32602)
      const value: string = userOp[key].toString()
      requireCond(value.match(HEX_REGEX) != null, `Invalid hex value for property ${key}:${value} in UserOp`, -32602)
    })
  }

  /**
   * eth_callUserOperation RPC api.
   * @param userOp1
   * @param entryPointInput
   */
  async callUserOperation (userOp1: UserOperationStruct, entryPointInput: string): Promise<CallUserOperationResult> {

    //TODO: currently performs separately the validation and execution.
    // should attempt to execute entire UserOp, so it can detect execution code dependency on validatiokn step.
    const ret = this.estimateUserOperationGas(userOp1, entryPointInput)
    let success: boolean
    let reason: string | undefined
    try {
      await this.provider.call({
        from: entryPointInput,
        to: userOp1.sender,
        data: userOp1.callData,
        gasLimit: userOp1.callGasLimit
      })
      success = true
    } catch (e: any) {
      success = false
      reason = e.error?.message ?? e.message
    }

    return {
      ...ret as any,
      success,
      reason
    }
  }

  /**
   * eth_estimateUserOperationGas RPC api.
   * @param userOp1
   * @param entryPointInput
   */
  async estimateUserOperationGas (userOp1: UserOperationStruct, entryPointInput: string): Promise<EstimateUserOpGasResult> {
    const provider = this.provider as JsonRpcProvider

    const userOp = {
      ...await resolveProperties(userOp1),
      paymasterAndData: '0x',
      signature: '0x'.padEnd(66 * 2, '1b'), //TODO: each wallet has to put in a signature in the correct size
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      preVerificationGas: 0,
      verificationGasLimit: 10e6
    }

    //todo: checks the existence of parameters, but since we hexlify the inputs, it fails to validate
    await this._validateParameters(deepHexlify(userOp), entryPointInput)

    const entryPointFromAddrZero = EntryPoint__factory.connect(entryPointInput, provider.getSigner(AddressZero))
    const errorResult = await entryPointFromAddrZero.callStatic.simulateValidation(userOp).catch(e => e)
    if (errorResult.errorName != 'SimulationResult') {
      throw errorResult
    }

    let {
      preOpGas,
      deadline
    } = errorResult.errorArgs
    const callGasLimit = await this.provider.estimateGas({
      from: this.entryPoint.address,
      to: userOp.sender,
      data: userOp.callData
    }).then(b => b.toNumber())
    deadline = BigNumber.from(deadline)
    if (deadline == 0) {
      deadline = undefined
    }
    const preVerificationGas = calcPreVerificationGas(userOp)
    const verificationGas = BigNumber.from(preOpGas).toNumber()
    return {
      preVerificationGas,
      verificationGas,
      deadline,
      callGasLimit
    }
  }

  //attempt "callUserOp" by using traceCall on handleOps, and parse the trace result.
  // can only report gas if real gas values are put (so it is not good for estimateGas
  async callUserOp_usingtraceCall (userOp: UserOperationStruct) {
    const provider = this.provider as JsonRpcProvider

    const handleOpsCallData = this.entryPoint.interface.encodeFunctionData('handleOps', [[deepHexlify(userOp)], await this.selectBeneficiary()])
    requireCond(await this.isGeth(), 'Implemented only for GETH', -32000)
    const result: BundlerCollectorReturn = await debug_traceCall(provider, {
      from: ethers.constants.AddressZero,
      to: this.entryPoint.address,
      data: handleOpsCallData,
      gasLimit: 10e6
    }, { tracer: bundlerCollectorTracer })
    result.debug = result.debug.map(err => {
      err = replaceMethodSig(err)
      const m = err.toString().match(/REVERT (.*)/)
      if (m == null) return err
      const r = decodeErrorReason(m[1])
      if (r == null) return err
      return `REVERT with "${r.message}" ${r.paymaster ?? ''}`
    })
    console.log('result=', result, result.logs)
  }

  /**
   * simulate UserOperation.
   * Note that simulation requires debug API:
   * - debug_traceCall, to trace the call.
   * @param userOp1
   * @param entryPointInput
   */
  async _simulateUserOp (userOp1: UserOperationStruct, entryPointInput: string): Promise<void> {
    const userOp = deepHexlify(await resolveProperties(userOp1))

    await this._validateParameters(userOp, entryPointInput, true)
    const simulateCall = this.entryPoint.interface.encodeFunctionData('simulateValidation', [userOp])

    const revert = await this.entryPoint.callStatic.simulateValidation(userOp, { gasLimit: 10e6 }).catch(e => e)
    // simulation always reverts. SimulateResult is a valid response with no error
    if (revert.errorName === 'FailedOp') {
      let data: any
      if (revert.errorArgs.paymaster !== AddressZero) {
        data = { paymaster: revert.errorArgs.paymaster }
      }
      throw new RpcError(revert.errorArgs.reason, -32500, data)
    }
    const provider = this.provider as JsonRpcProvider
    if (await this.isGeth()) {
      debug('=== sending simulate')
      const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

      const result: BundlerCollectorReturn = await debug_traceCall(provider, {
        from: ethers.constants.AddressZero,
        to: this.entryPoint.address,
        data: simulateCall,
        gasLimit: simulationGas
      }, { tracer: bundlerCollectorTracer })

      debug('=== simulation result:', result)
      // todo: validate keccak, access
      // todo: block access to no-code addresses (might need update to tracer)

      const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'GAS', 'CREATE', 'COINBASE'])

      const paymaster = (userOp.paymasterAndData?.length ?? 0) >= 42 ? userOp.paymasterAndData.toString().slice(0, 42) : undefined
      if (Object.values(result.numberLevels).length < 2) {
        throw new Error('unexpected traceCall result: no tracer or no NUMBER opcodes')
      }
      const validateOpcodes = result.numberLevels['0'].opcodes
      const validatePaymasterOpcodes = result.numberLevels['1'].opcodes
      // console.log('debug=', result.debug.join('\n- '))
      Object.keys(validateOpcodes).forEach(opcode =>
        requireCond(!bannedOpCodes.has(opcode), `account uses banned opcode: ${opcode}`, 32501)
      )
      Object.keys(validatePaymasterOpcodes).forEach(opcode =>
        requireCond(!bannedOpCodes.has(opcode), `paymaster uses banned opcode: ${opcode}`, 32501, { paymaster })
      )
      if (userOp.initCode.length > 2) {
        requireCond((validateOpcodes.CREATE2 ?? 0) <= 1, 'initCode with too many CREATE2', 32501)
      } else {
        requireCond((validateOpcodes.CREATE2 ?? 0) < 1, 'banned opcode: CREATE2', 32501)
      }
      requireCond((validatePaymasterOpcodes.CREATE2 ?? 0) < 1, 'paymaster uses banned opcode: CREATE2', 32501, { paymaster })
    }
  }

  async sendUserOperation (userOp1: UserOperationStruct, entryPointInput: string): Promise<string> {
    await this._validateParameters(userOp1, entryPointInput, true)

    const userOp = await resolveProperties(userOp1)
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }

    console.log(`UserOperation: Sender=${userOp.sender} EntryPoint=${entryPointInput} Paymaster=${hexValue(userOp.paymasterAndData)}`)

    await this._simulateUserOp(userOp1, entryPointInput)
    const beneficiary = await this.selectBeneficiary()
    const userOpHash = await this.entryPoint.getUserOpHash(userOp)

    // TODO: this is only printing debug info, remove once not necessary
    // await this.printGasEstimationDebugInfo(userOp, beneficiary)

    const expectedPreVerificationGas = calcPreVerificationGas(userOp)
    const preVerificationGas = BigNumber.from(await userOp.preVerificationGas).toNumber()
    if (expectedPreVerificationGas > preVerificationGas) {
      throw new Error(`userOp.preVerificationGas too low: expected ${expectedPreVerificationGas} but got ${preVerificationGas}`)
    }

    const gasLimit = undefined
    debug('using gasLimit=', gasLimit)
    await this.entryPoint.handleOps([userOp], beneficiary, { gasLimit }).catch(rethrowError)

    // await postExecutionDump(this.entryPoint, userOpHash)
    return userOpHash
  }

  async _getUserOperationEvent (userOpHash: string): Promise<UserOperationEventEvent> {
    const event = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationEvent(userOpHash))
    return event[0]
  }

  async getUserOperationReceipt (userOpHash: string): Promise<any> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const receipt = await event.getTransactionReceipt() as any
    receipt.status = event.args.success ? 1 : 0
    receipt.userOpHash = userOpHash
    return deepHexlify(receipt)
  }

  async getUserOperationTransactionByHash (userOpHash: string): Promise<any> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const tx = await event.getTransaction() as any
    tx.userOpHash = userOpHash
    return deepHexlify(tx)
  }
}
