import { BigNumber, utils, Wallet } from 'ethers'
import { JsonRpcSigner, Provider } from '@ethersproject/providers'
import { UserOperation } from '@erc4337/common/dist/src/UserOperation'

import { BundlerConfig } from './BundlerConfig'
import { EntryPoint, BundlerHelper } from '@erc4337/common/dist/src/types'

export class UserOpMethodHandler {
  constructor (
    readonly provider: Provider,
    readonly signer: Wallet | JsonRpcSigner,
    readonly config: BundlerConfig,
    readonly entryPoint: EntryPoint,
    readonly bundlerHelper: BundlerHelper
  ) {
  }

  async eth_chainId (): Promise<string | undefined> {
    return await this.provider.getNetwork().then(net => utils.hexlify(net.chainId))
  }

  async eth_supportedEntryPoints (): Promise<string[]> {
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

  async sendUserOperation (userOp: UserOperation, entryPointInput: string): Promise<string> {
    if (entryPointInput.toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }

    console.log(`UserOperation: Sender=${userOp.sender} EntryPoint=${this.config.entryPoint} Paymaster=${userOp.paymaster}`)

    const beneficiary = await this.selectBeneficiary()
    const requestId = await this.entryPoint.getRequestId(userOp)

    // TODO: this is only printing debug info, remove once not necessary
    await this.printGasEstimationDebugInfo(userOp, beneficiary)

    // TODO: this is not used and 0 passed insted as transaction does not pay enough
    // const estimateGasFactored = await this.estimateGasForHelperCall(userOp, beneficiary)

    await this.bundlerHelper.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
    return requestId
  }

  async estimateGasForHelperCall (userOp: UserOperation, beneficiary: string): Promise<BigNumber> {
    const estimateGasRet = await this.bundlerHelper.estimateGas.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
    const estimateGas = estimateGasRet.mul(64).div(63)
    return estimateGas.mul(Math.round(this.config.gasFactor * 100000)).div(100000)
  }

  async printGasEstimationDebugInfo (userOp: UserOperation, beneficiary: string): Promise<void> {
    const [estimateGasRet, estHandleOp, staticRet] = await Promise.all([
      this.bundlerHelper.estimateGas.handleOps(0, this.config.entryPoint, [userOp], beneficiary),
      this.entryPoint.estimateGas.handleOps([userOp], beneficiary),
      this.bundlerHelper.callStatic.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
    ])
    const estimateGas = estimateGasRet.mul(64).div(63)
    const estimateGasFactored = estimateGas.mul(Math.round(this.config.gasFactor * 100000)).div(100000)
    console.log('estimated gas', estimateGas.toString())
    console.log('handleop est ', estHandleOp.toString())
    console.log('ret=', staticRet)
    console.log('preVerificationGas', parseInt(userOp.preVerificationGas.toString()))
    console.log('verificationGas', parseInt(userOp.verificationGas.toString()))
    console.log('callGas', parseInt(userOp.callGas.toString()))
    console.log('Total estimated gas for bundler compensation: ', estimateGasFactored)
  }
}
