import { BigNumber } from 'ethers'
import { NotPromise } from '@account-abstraction/utils'
import { UserOperation } from './moduleUtils'
import { RpcError } from '../utils'

export interface MempoolEntry {
  userOp: UserOperation
  //aggregator, if one was found during simulation
  aggregator?: string
}

export class MempoolManager {
  mempool: MempoolEntry[] = []

  dump () {

  }

  //add userOp into the mempool, after initial validation.
  //replace existing, if any (and if new gas is higher)
  addUserOp (userOp: UserOperation, aggregator?: string) {
    let entry = {
      userOp,
      aggregator
    }
    const index = this._find(userOp)
    if (index != -1) {
      const oldGas = BigNumber.from(this.mempool[index].userOp.maxPriorityFeePerGas).toNumber()
      const newGas = BigNumber.from(entry.userOp.maxPriorityFeePerGas).toNumber()
      if (newGas < oldGas * 1.1) {
        throw new RpcError('Replacement transaction must have higher gas')
      }
      this.mempool[index] = entry
    } else {
      this.mempool.push(entry)
    }
  }

  getSortedForInclusion (): MempoolEntry[] {
    const copy = Array.from(this.mempool)

    function cost (op: UserOperation): number {
      //TODO: need to consult basefee and maxFeePerGas
      return BigNumber.from(op.maxPriorityFeePerGas).toNumber()
    }

    copy.sort((a, b) => cost(a.userOp) - cost(b.userOp))
    return copy
  }

  _find (userOp: UserOperation): number {
    for (let i = 0; i < this.mempool.length; i++) {
      const curOp = this.mempool[i].userOp
      if (curOp.sender == userOp.sender && curOp.nonce == userOp.nonce) {
        return i
      }
    }
    return -1
  }

  removeUserOp (userOp: UserOperation) {
    const index = this._find(userOp)
    if (index != -1) {
      this.mempool.splice(index, 1)
    }
  }

  removeAllUserOps (userOps: UserOperation[]) {
    //todo: removing (almost) all userOps from mempool. might use better way than finding and slicing
    // each one separately...
    for (let userOp of userOps) {
      this.removeUserOp(userOp)
    }
  }
}
