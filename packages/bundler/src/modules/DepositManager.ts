import { BigNumber } from 'ethers'
import { getUserOpMaxCost, IEntryPoint, requireCond, UserOperation, ValidationErrors } from '@account-abstraction/utils'
import { MempoolManager } from './MempoolManager'

/**
 * manage paymaster deposits, to make sure a paymaster has enough gas for all its pending transaction in the mempool
 * [EREP-010]
 */
export class DepositManager {
  deposits: { [addr: string]: BigNumber } = {}

  constructor (readonly entryPoint: IEntryPoint, readonly mempool: MempoolManager) {
  }

  async checkPaymasterDeposit (userOp: UserOperation): Promise<void> {
    const paymaster = userOp.paymaster
    if (paymaster == null) {
      return
    }
    let deposit = await this.getCachedDeposit(paymaster)
    deposit = deposit.sub(getUserOpMaxCost(userOp))

    for (const entry of this.mempool.getMempool()) {
      if (entry.userOp.paymaster === paymaster) {
        deposit =
          deposit.sub(BigNumber.from(getUserOpMaxCost(userOp)))
      }
    }

    // [EREP-010] paymaster is required to have balance for all its pending transactions.
    // on-chain AA31 checks the deposit for the current userop.
    // but submitting all these UserOps it will eventually abort on this error,
    // so it's fine to return the same code.
    requireCond(deposit.gte(0), 'AA31 paymaster deposit too low for all mempool UserOps', ValidationErrors.SimulatePaymasterValidation)
  }

  /**
   * clear deposits after some known change on-chain
   */
  clearCache (): void {
    this.deposits = {}
  }

  async getCachedDeposit (addr: string): Promise<BigNumber> {
    let deposit = this.deposits[addr]
    if (deposit == null) {
      deposit = this.deposits[addr] = await this.entryPoint.balanceOf(addr)
    }
    return deposit
  }
}
