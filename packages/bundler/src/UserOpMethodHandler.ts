import { BigNumber, Wallet } from 'ethers'
import { JsonRpcSigner, Provider } from '@ethersproject/providers'

import { BundlerConfig } from './BundlerConfig'
import { BundlerHelper, EntryPoint } from './types'
import { UserOperationStruct } from './types/contracts/BundlerHelper'
import { arrayify, defaultAbiCoder, hexlify, hexValue, keccak256, resolveProperties } from 'ethers/lib/utils'

export class UserOpMethodHandler {
  constructor (
    readonly provider: Provider,
    readonly signer: Wallet | JsonRpcSigner,
    readonly config: BundlerConfig,
    readonly entryPoint: EntryPoint,
    readonly bundlerHelper: BundlerHelper
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

    let estimated: BigNumber
    let factored: BigNumber
    try {
      // TODO: this is not used and 0 passed instead as transaction does not pay enough
      ({
        estimated,
        factored
      } = await this.estimateGasForHelperCall(userOp, beneficiary))
    } catch (error: any) {
      // console.log('estimateGasForHelperCall failed:', error)
      throw error
    }
    // TODO: estimate gas and pass gas limit that makes sense
    await this.bundlerHelper.handleOps(factored, this.config.entryPoint, [userOp], beneficiary, { gasLimit: estimated.mul(3) })
    return requestId
  }

  async estimateGasForHelperCall (userOp: UserOperationStruct, beneficiary: string): Promise<{
    estimated: BigNumber
    factored: BigNumber
  }> {
    try {
      const estimateGasRet = await this.bundlerHelper.estimateGas.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
      const estimated = estimateGasRet.mul(64).div(63)
      const factored = estimated.mul(Math.round(parseFloat(this.config.gasFactor) * 100000)).div(100000)
      return {
        estimated,
        factored
      }
    } catch (e: any) {
      const match = e.message?.toString().match(/(FailedOp\(.*?\))/)
      if (match != null) {
        const e1 = new Error(match[1])
        // e1.stack = e.stack.replace(/.*/, match[1])
        throw e1
      } else {
        const FailedOpErrorSig = keccak256(hexlify(Buffer.from('FailedOp(uint256,address,string)'))).slice(0, 10)// = '0x00fa072b'
        if (e?.error?.data != null && e.error.data.toString().startsWith(FailedOpErrorSig)) {
          const [index, paymaster, message] = defaultAbiCoder.decode(['uint256', 'address', 'string'], '0x' + e.error.data.slice(10))
          throw Error(`FailedOp(${index}, ${paymaster}, ${message})`)
        }
        //try callStatic. might get nicer output:
        const err = await this.bundlerHelper.callStatic.handleOps(0, this.config.entryPoint, [userOp], beneficiary).then(res => {
          return Error('expected callStatic to fail...')
        }, err => {
          return err
        })
        console.log('throwing unmodified e')
        throw e
      }

      // throw e
      // //callstatic fails with nicer errors...
      // await this.bundlerHelper.callStatic.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
      // throw new Error('unexpected: if estimateGas fails, callStatic must also fail.')
    }
  }

  async printGasEstimationDebugInfo (userOp1: UserOperationStruct, beneficiary: string): Promise<void> {
    const userOp = await resolveProperties(userOp1)

    const [estimateGasRet, estHandleOp, staticRet] = await Promise.all([
      this.bundlerHelper.estimateGas.handleOps(0, this.config.entryPoint, [userOp], beneficiary),
      this.entryPoint.estimateGas.handleOps([userOp], beneficiary),
      this.bundlerHelper.callStatic.handleOps(0, this.config.entryPoint, [userOp], beneficiary)
    ])
    const estimateGas = estimateGasRet.mul(64).div(63)
    const estimateGasFactored = estimateGas.mul(Math.round(parseInt(this.config.gasFactor) * 100000)).div(100000)
    console.log('estimated gas', estimateGas.toString())
    console.log('handleOp est ', estHandleOp.toString())
    console.log('ret=', staticRet)
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    console.log('preVerificationGas', parseInt(userOp.preVerificationGas.toString()))
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    console.log('verificationGas', parseInt(userOp.verificationGasLimit.toString()))
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    console.log('callGas', parseInt(userOp.callGasLimit.toString()))
    console.log('Total estimated gas for bundler compensation: ', estimateGasFactored)
  }
}
