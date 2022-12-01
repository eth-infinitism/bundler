import { EntryPoint } from '@account-abstraction/contracts'
import { MempoolManager } from './MempoolManager'
import { ValidationManager, ValidationResult } from './ValidationManager'
import { BigNumber, BigNumberish } from 'ethers'
import { getAddr, UserOperation } from './moduleUtils'
import { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers'
import Debug from 'debug'
import { packUserOp } from '@account-abstraction/utils'

const debug = Debug('aa.cron')

export class BundleManager {
  provider: JsonRpcProvider
  signer: JsonRpcSigner

  constructor (
    readonly entryPoint: EntryPoint,
    readonly mempoolManager: MempoolManager,
    readonly validationManager: ValidationManager,
    readonly beneficiary: string,
    readonly minSignerBalance: BigNumberish ,
    readonly maxBundleGas: number
  ) {
    this.provider = entryPoint.provider as JsonRpcProvider
    this.signer = this.provider.getSigner()
  }

  sendBundleActive = false

  /**
   * attempt to send a bundle:
   * collect UserOps from mempool into a bundle
   * send this bundle.
   */
  async sendNextBundle () {
    try {
      if (this.sendBundleActive) {
        debug('sendNextBundle: not reentered')
        return
      }
      this.sendBundleActive = true
      debug('sendNextBundle')

      const bundle = await this.createBundle()
      const beneficiary = await this._selectBeneficiary()
      await this.sendBundle(bundle, beneficiary)
      debug('sendNextBundle exit')
    } finally {
      this.sendBundleActive = false
    }
  }

  /**
   * submit a bundle.
   * after submitting the bundle, remove all UserOps from the mempool
   */
  async sendBundle (userOps: UserOperation[], beneficiary: string) {
    await this.entryPoint.handleOps(userOps, beneficiary)
    this.mempoolManager.removeAllUserOps(userOps)
  }

  async createBundle (): Promise<UserOperation[]> {
    const entries = this.mempoolManager.getSortedForInclusion()
    let bundle: UserOperation[] = []

    const paymasterBalance: { [paymaster: string]: BigNumber } = {}
    //count how many ops per paymaster in the bundle
    const paymasterCount: { [paymaster: string]: number } = {}
    let totalGas = BigNumber.from(0)
    for (const entry of entries) {
      let validationResult: ValidationResult
      try {
        validationResult = await this.validationManager.validateUserOp(entry.userOp)
      } catch (e) {
        //failed validation. don't try any more
        this.mempoolManager.removeUserOp(entry.userOp)
        continue
      }
      // todo: we take UserOp's callGasLimit, even though it will probably require less (but we don't
      // attempt to esdtimate it to check)
      // which means we could "cram" more UserOps into a bundle.
      const userOpGasCost = BigNumber.from(validationResult.preOpGas).add(entry.userOp.callGasLimit)
      const newTotalGas = totalGas.add(userOpGasCost)
      if (newTotalGas.gt(this.maxBundleGas)) {
        break
      }
      const paymaster = getAddr(entry.userOp.paymasterAndData)
      if (paymaster != null) {
        if (paymasterBalance[paymaster] == null) {
          paymasterBalance[paymaster] = await this.entryPoint.balanceOf(paymaster)
        }
        if (paymasterBalance[paymaster].lt(validationResult.prefund)) {
          // not enough balance in paymaster to pay for all UserOps
          // (but it passed validation, so it can sponsor them separately
          continue
        }
        paymasterBalance[paymaster]  = paymasterBalance[paymaster].sub(validationResult.prefund)
      }
      bundle.push(entry.userOp)
      totalGas = newTotalGas
    }
    return bundle
  }

  /**
   * determine who should receive the proceedings of the request.
   * if signer's balance is too low, send it to signer. otherwise, send to configured beneficiary.
   */
  async _selectBeneficiary (): Promise<string> {
    const currentBalance = await this.provider.getBalance(this.signer.getAddress())
    let beneficiary = this.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.minSignerBalance)) {
      beneficiary = await this.signer.getAddress()
      console.log('low balance. using ', beneficiary, 'as beneficiary instead of ', this.beneficiary)
    }
    return beneficiary
  }
}
