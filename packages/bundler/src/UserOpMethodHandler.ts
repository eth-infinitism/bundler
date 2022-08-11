import { BigNumberish, utils } from 'ethers'
import { UserOperation } from '@erc4337/common/dist/UserOperation'
import { BundlerHelper, EntryPoint__factory } from '@erc4337/helper-contracts/types'
import { Provider } from '@ethersproject/providers'

export class UserOpMethodHandler {
  private supportedEntryPoints: string[] = []
  provider!: Provider
  signer: any
  private beneficiary: string = ''
  private minBalance!: BigNumberish
  private bundlerHelper!: BundlerHelper
  private gasFactor!: number

  async eth_chainId (): Promise<string | undefined> {
    return await this.provider.getNetwork().then(net => utils.hexlify(net.chainId))
  }

  async eth_supportedEntryPoints (): Promise<string[]> {
    return this.supportedEntryPoints
  }

  async eth_sendUserOperation (userOp: UserOperation, entryPointAddress: string): Promise<string> {
    const entryPoint = EntryPoint__factory.connect(entryPointAddress, this.signer)
    if (!this.supportedEntryPoints.includes(utils.getAddress(entryPointAddress))) {
      throw new Error(`entryPoint "${entryPointAddress}" not supported. use one of ${this.supportedEntryPoints.toString()}`)
    }
    console.log(`userOp ep=${entryPointAddress} sender=${userOp.sender} pm=${userOp.paymaster}`)
    const currentBalance = await this.provider.getBalance(this.signer.address)
    let b = this.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.minBalance)) {
      b = this.signer.address
      console.log('low balance. using ', b, 'as beneficiary instead of ', this.beneficiary)
    }

    const [estimateGasRet, estHandleOp, staticRet] = await Promise.all([
      this.bundlerHelper.estimateGas.handleOps(0, entryPointAddress, [userOp], b),
      entryPoint.estimateGas.handleOps([userOp], b),
      this.bundlerHelper.callStatic.handleOps(0, entryPointAddress, [userOp], b)
    ])
    const estimateGas = estimateGasRet.mul(64).div(63)
    console.log('estimated gas', estimateGas.toString())
    console.log('handleop est ', estHandleOp.toString())
    console.log('ret=', staticRet)
    console.log('preVerificationGas', parseInt(userOp.preVerificationGas.toString()))
    console.log('verificationGas', parseInt(userOp.verificationGas.toString()))
    console.log('callGas', parseInt(userOp.callGas.toString()))
    const reqid = entryPoint.getRequestId(userOp)
    const estimateGasFactored = estimateGas.mul(Math.round(this.gasFactor * 100000)).div(100000)
    await this.bundlerHelper.handleOps(estimateGasFactored, entryPointAddress, [userOp], b)
    return await reqid
  }
}
