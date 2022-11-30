import { EntryPoint } from '@account-abstraction/contracts'
import { MempoolManager } from './MempoolManager'
import { ValidationManager } from './ValidationManager'
import { BigNumber } from 'ethers'
import { getAddr, UserOperation } from './moduleUtils'
import { applyProviderWrappers } from 'hardhat/internal/core/providers/construction'

class BundleManager {
  constructor (
    readonly entryPoint: EntryPoint,
    readonly mempoolManager: MempoolManager,
    readonly validationManager: ValidationManager,
    readonly beneficiary: string
  ) {
  }

  async createBundle (): Promise<UserOperation[]> {
    const entries = this.mempoolManager.getSortedForInclusion()
    let bundle: UserOperation[] = []

    const paymasterBalance: { [paymaster: string]: BigNumber } = {}
    for (const entry of entries) {
      try {
        this.validationManager.validateUserOp(entry.userOp)
      } catch (e) {
        //failed validation. don't try any more
        this.mempoolManager.removeUserOp(entry.userOp)
        continue
      }
      const paymaster = getAddr(entry.userOp.paymasterAndData)
      if (paymaster != null) {
        if (paymasterBalance[paymaster] == null) {
          paymasterBalance[paymaster] = await this.entryPoint.balanceOf(paymaster)
        }

      }
    }
    return bundle
  }

  async sendBundle (userOps: UserOperation[], beneficiary: string) {
    await this.entryPoint.handleOps(userOps, beneficiary)
    this.mempoolManager.removeAllUserOps(userOps)
  }

  /*
  get list from mempoolManager
  check deployer, pm status from reputationManager
  rescan using validationManager
  Remove dead (invalid)
  sendBundle
  Create bundle
  Send to blockchain
  Remove all ops from mempool
  bundleCron
  Periodic create bundle (periodic or by min/max mempool size)
*/

}
