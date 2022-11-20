import { BigNumber, Wallet } from 'ethers'
import { JsonRpcProvider, JsonRpcSigner, Provider } from '@ethersproject/providers'
import { BundlerConfig } from './BundlerConfig'
import { EntryPoint } from './types'
import { UserOperationStruct } from './types/contracts/BundlerHelper'
import { hexValue, resolveProperties } from 'ethers/lib/utils'
import { rethrowError } from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk/dist/src/calcPreVerificationGas'
import { debug_traceCall } from './GethTracer'
import { BundlerCollectorReturn, bundlerCollectorTracer } from './BundlerCollectorTracer'
import Debug from 'debug'

const debug = Debug('aa.handler.userop')

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

  /**
   * simulate UserOperation.
   * Note that simulation requires debug API:
   * - debug_traceCall, to trace the call.
   * @param userOp1
   * @param entryPointInput
   */
  async simulateUserOp (userOp1: UserOperationStruct, entryPointInput: string) {

    const userOp = await resolveProperties(userOp1)
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }
    const simulateCall = this.entryPoint.interface.encodeFunctionData('simulateValidation', [userOp1, false])

    const provider = this.provider as JsonRpcProvider
    if (await this.isGeth()) {
      console.log('=== sending simulate')
      const simulationGas = BigNumber.from(50000).add(userOp.verificationGasLimit)

      const result: BundlerCollectorReturn = await debug_traceCall(provider, {
        from: this.signer.getAddress(),
        to: this.entryPoint.address,
        data: simulateCall,
        gasLimit: simulationGas
      }, { tracer: bundlerCollectorTracer })

      function require (cond: boolean, msg: string) {
        if (!cond) throw new Error(msg)
      }

      //todo: validate keccak, access
      //todo: block access to no-code addresses (might need update to tracer)

      const bannedOpCodes = new Set([`GASPRICE`, `GASLIMIT`, `DIFFICULTY`, `TIMESTAMP`, `BASEFEE`, `BLOCKHASH`, `NUMBER`, `SELFBALANCE`, `BALANCE`, `ORIGIN`, `GAS`, `CREATE`, `COINBASE`])

      const validateOpcodes = result.numberLevels['0'].opcodes
      const validatePaymasterOpcodes = result.numberLevels['1'].opcodes
      Object.keys(validateOpcodes).forEach(opcode =>
        require(!bannedOpCodes.has(opcode), `wallet uses banned opcode: '${opcode}`)
      )
      Object.keys(validatePaymasterOpcodes).forEach(opcode =>
        require(!bannedOpCodes.has(opcode), `paymaster uses banned opcode: '${opcode}`)
      )
      if (userOp.initCode.length > 2) {
        require(validateOpcodes['CREATE2'] <= 1, 'initCode with too many CREATE2')
      } else {
        require(validateOpcodes['CREATE2'] < 1, 'banned opcode: CREATE2')
      }
      require(validatePaymasterOpcodes['CREATE2'] < 1, 'paymaster uses banned opcode: CREATE2')
    }
  }

  async sendUserOperation (userOp1: UserOperationStruct, entryPointInput: string): Promise<string> {
    const userOp = await resolveProperties(userOp1)
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }

    console.log(`UserOperation: Sender=${userOp.sender} EntryPoint=${entryPointInput} Paymaster=${hexValue(userOp.paymasterAndData)}`)

    await this.simulateUserOp(userOp1, entryPointInput)
    const beneficiary = await this.selectBeneficiary()
    const requestId = await this.entryPoint.getRequestId(userOp)

    // TODO: this is only printing debug info, remove once not necessary
    // await this.printGasEstimationDebugInfo(userOp, beneficiary)

    const expectedPreVerificationGas = calcPreVerificationGas(userOp)
    const preVerificationGas = BigNumber.from(await userOp.preVerificationGas).toNumber()
    if (expectedPreVerificationGas > preVerificationGas) {
      throw new Error(`userOp.preVerificationGas too low: expected ${expectedPreVerificationGas} but got ${preVerificationGas}`)
    }

    const gasLimit = undefined
    console.log('using gasLimit=', gasLimit)
    await this.entryPoint.handleOps([userOp], beneficiary, { gasLimit }).catch(rethrowError)

    // await postExecutionDump(this.entryPoint, requestId)
    return requestId
  }
}
