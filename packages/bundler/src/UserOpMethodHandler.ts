import { BigNumber, Wallet } from 'ethers'
import { JsonRpcSigner, Provider } from '@ethersproject/providers'

import { BundlerConfig } from './BundlerConfig'
import { EntryPoint } from './types'
import { UserOperationStruct } from './types/contracts/BundlerHelper'
import { hexValue, resolveProperties } from 'ethers/lib/utils'
import { rethrowError } from '@account-abstraction/utils'
import { calcPreVerificationGas } from '@account-abstraction/sdk/dist/src/calcPreVerificationGas'
// import { postExecutionDump } from '@account-abstraction/utils/dist/src/postExecCheck'

export class UserOpMethodHandler {
  constructor (
    readonly provider: Provider,
    readonly signer: Wallet | JsonRpcSigner,
    readonly config: BundlerConfig,
    readonly entryPoint: EntryPoint
    // readonly bundlerHelper: BundlerHelper
  ) {
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

  async sendUserOperation (userOp1: UserOperationStruct, entryPointInput: string): Promise<string> {
    const userOp = await resolveProperties(userOp1)
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }

    console.log(`UserOperation: Sender=${userOp.sender} EntryPoint=${entryPointInput} Paymaster=${hexValue(userOp.paymasterAndData)}`)

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
