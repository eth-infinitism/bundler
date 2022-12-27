import { BigNumber, BigNumberish } from 'ethers'
import { getAddr, UserOperation } from './moduleUtils'
import { requireCond } from '../utils'
import { ValidationErrors } from './ValidationManager'
import { ReputationManager } from './ReputationManager'
import Debug from 'debug'

const debug = Debug('aa.mempool')

export interface MempoolEntry {
  userOp: UserOperation
  prefund: BigNumberish
  // aggregator, if one was found during simulation
  aggregator?: string
}

type MempoolDump = UserOperation[]

export class MempoolManager {
  private mempool: MempoolEntry[] = []

  constructor (
    readonly reputationManager: ReputationManager) {
  }

  count (): number {
    return this.mempool.length
  }

  // add userOp into the mempool, after initial validation.
  // replace existing, if any (and if new gas is higher)
  addUserOp (userOp: UserOperation, prefund: BigNumberish, aggregator?: string): void {
    const entry: MempoolEntry = {
      userOp,
      prefund,
      aggregator
    }
    const index = this._find(userOp)
    if (index !== -1) {
      const oldEntry = this.mempool[index]
      const oldGas = BigNumber.from(oldEntry.userOp.maxPriorityFeePerGas).toNumber()
      const newGas = BigNumber.from(entry.userOp.maxPriorityFeePerGas).toNumber()
      // the error is "invalid fields", even though it is detected only after validation
      requireCond(newGas > oldGas * 1.1,
        'Replacement UserOperation must have higher gas', ValidationErrors.InvalidFields)
      debug('replace userOp', userOp.sender, userOp.nonce)
      this.mempool[index] = entry
    } else {
      debug('add userOp', userOp.sender, userOp.nonce)
      this.mempool.push(entry)
    }

    this.reputationManager.updateSeenStatus(aggregator)
    this.reputationManager.updateSeenStatus(getAddr(userOp.paymasterAndData))
    this.reputationManager.updateSeenStatus(getAddr(userOp.initCode))
  }

  getSortedForInclusion (): MempoolEntry[] {
    const copy = Array.from(this.mempool)

    function cost (op: UserOperation): number {
      // TODO: need to consult basefee and maxFeePerGas
      return BigNumber.from(op.maxPriorityFeePerGas).toNumber()
    }

    copy.sort((a, b) => cost(a.userOp) - cost(b.userOp))
    return copy
  }

  _find (userOp: UserOperation): number {
    for (let i = 0; i < this.mempool.length; i++) {
      const curOp = this.mempool[i].userOp
      if (curOp.sender === userOp.sender && curOp.nonce === userOp.nonce) {
        return i
      }
    }
    return -1
  }

  /**
   * remove UserOp from mempool. either it is invalid, or was included in a block
   * @param userOp
   */
  removeUserOp (userOp: UserOperation): void {
    const index = this._find(userOp)
    if (index !== -1) {
      debug('removeUserOp', userOp.sender, userOp.nonce)
      this.mempool.splice(index, 1)
    }
  }

  removeAllUserOps (userOps: UserOperation[]): void {
    // todo: removing (almost) all userOps from mempool. might use better way than finding and slicing
    // each one separately...
    for (const userOp of userOps) {
      this.removeUserOp(userOp)
    }
  }

  /**
   * debug: dump mempool content
   */
  dump (): MempoolDump {
    return this.mempool.map(entry => entry.userOp)
  }

  /**
   * for debugging: clear current in-memory state
   */
  clearState (): void {
    this.mempool = []
  }
}
