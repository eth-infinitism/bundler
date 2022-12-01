import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { ReputationManager } from './ReputationManager'
import { EntryPoint } from '@account-abstraction/contracts'
import { UserOperation } from './moduleUtils'

/**
 * listen to events. trigger ReputationManager's Included
 */
class EventsManager {

  lastTx = ''
  lastBlock = 0

  constructor (
    readonly entryPoint: EntryPoint,
    readonly reputationManager: ReputationManager) {
  }

  /**
   * automatically listen to all UserOperationEvent events
   * @param entryPoint
   */
  initEventListener () {
    this.entryPoint.on(this.entryPoint.filters.UserOperationEvent(), (ev) => {
      //todo: check event typing. typechain thinks its a string
      this.handleEvent(ev as any)
    })
  }

  /**
   * manually handle all new events since last run
   * @param entryPoint
   */
  async handlePastEvents () {
    const events = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationEvent(), this.lastBlock)
    events.forEach(ev => {
      this.handleEvent(ev)
    })
  }

  async handleEvent (ev: UserOperationEventEvent) {
    //process a single handleEvent for a bundle (transaction), since we read entire bundle data on that first event.
    //TODO: this will break if someone bundles MULTIPLE handleOp calls into a single transaction (but it also breaks our decoding of transaction)
    if (ev.transactionHash == this.lastTx) {
      return
    }
    this.lastTx = ev.transactionHash
    this.lastBlock = ev.blockNumber
    const tx = await ev.getTransaction()
    const handleOpsFuncFragment = this.entryPoint.interface.getFunction('handleOps')
    const ret = this.entryPoint.interface.decodeFunctionData(handleOpsFuncFragment, tx.data)
    const userOps: UserOperation[] = ret[0]
    userOps.forEach(userOp => {
      this._includedAddress(userOp.initCode as any)
      this._includedAddress(userOp.paymasterAndData as any)
      //TODO: do we handle aggerator?
    })
  }

  _includedAddress (data: string) {
    if (data.length > 42) {
      const addr = data.slice(0, 42)
      this.reputationManager.updateIncludedStatus(addr)
    }
  }
}
