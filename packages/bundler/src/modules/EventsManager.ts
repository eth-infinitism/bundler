import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { ReputationManager } from './ReputationManager'
import { EntryPoint, IEntryPoint__factory } from '@account-abstraction/contracts'
import { UserOperation } from './moduleUtils'

/**
 * listen to events. trigger ReputationManager's Included
 */
class EventsManager {

  readonly epInterface = IEntryPoint__factory.createInterface()
  readonly handleOpsFunc = Object.values(this.epInterface.functions).find(frag => frag.name == 'handleOps')!

  lastTx = ''

  constructor (readonly reputationManager: ReputationManager) {
  }

  /**
   * listen to all events
   * @param ep
   */
  listen (ep: EntryPoint) {
    ep.on(ep.filters.UserOperationEvent(), (ev) => {
      //todo: check event typing. typechain thinks its a string
      this.handleEvent(ev as any)
    })
  }

  async handleEvent (ev: UserOperationEventEvent) {
    //process a single handleEvent for a bundle (transaction), since we read entire bundle data on that first event.
    //TODO: this will break if someone bundles MULTIPLE handleOp calls into a single transaction (but it also breaks our decoding of transaction)
    if (ev.transactionHash == this.lastTx) {
      return
    }
    this.lastTx = ev.transactionHash
    const tx = await ev.getTransaction()
    const ret = this.epInterface.decodeFunctionData(this.handleOpsFunc, tx.data)
    const userOps: UserOperation[] = ret[0]
    userOps.forEach(userOp => {
      this._seenAddress(userOp.initCode as any)
      this._seenAddress(userOp.paymasterAndData as any)
      //TODO: do we handle aggerator?
    })
  }

  _seenAddress (data: string) {
    if (data.length > 42) {
      const addr = data.slice(0, 42)
      this.reputationManager.updateIncludedStatus(addr)
    }
  }
}
