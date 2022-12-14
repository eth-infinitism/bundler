import { AccountDeployedEvent, UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { ReputationManager } from './ReputationManager'
import { EntryPoint } from '@account-abstraction/contracts'
import Debug from 'debug'
import { SignatureAggregatorChangedEvent } from '@account-abstraction/contracts/types/EntryPoint'
import { TypedEvent } from '@account-abstraction/contracts/dist/types/common'

const debug = Debug('aa.events')

/**
 * listen to events. trigger ReputationManager's Included
 */
export class EventsManager {
  lastBlock = 0

  constructor (
    readonly entryPoint: EntryPoint,
    readonly reputationManager: ReputationManager) {
  }

  /**
   * automatically listen to all UserOperationEvent events
   */
  initEventListener (): void {
    this.entryPoint.on(this.entryPoint.filters.UserOperationEvent(), (...args) => {
      const ev = args.slice(-1)[0]
      void this.handleEvent(ev as any)
    })
  }

  /**
   * manually handle all new events since last run
   */
  async handlePastEvents (): Promise<void> {
    const events = await this.entryPoint.queryFilter({ address: this.entryPoint.address }, this.lastBlock)
    for (const ev of events) {
      await this.handleEvent(ev)
    }
  }

  async handleEvent (ev: UserOperationEventEvent | AccountDeployedEvent | SignatureAggregatorChangedEvent): Promise<void> {
    switch (ev.event) {
      case 'UserOperationEventEvent':
        this.handleUserOperationEvent(ev as any)
        break
      case 'AccountDeployedEvent':
        this.handleAccountDeployedEvent(ev as any)
        break
      case 'SignatureAggregatorForUserOperationsEvent':
        this.handleAggregatorChangedEvent(ev as any)
        break
    }
  }

  handleAggregatorChangedEvent (ev: SignatureAggregatorChangedEvent): void {
    debug('handle ', ev.event, ev.args.aggregator)
    this.eventAggregator = ev.args.aggregator
    this.eventAggregatorTxHash = ev.transactionHash
  }

  eventAggregator: string | null = null
  eventAggregatorTxHash: string | null = null

  // aggregator event is sent once per events bundle for all UserOperationEvents in this bundle.
  // it is not sent at all if the transaction is handleOps
  getEventAggregator (ev: TypedEvent): string | null {
    if (ev.transactionHash !== this.eventAggregatorTxHash) {
      this.eventAggregator = null
      this.eventAggregatorTxHash = ev.transactionHash
    }
    return this.eventAggregator
  }

  // AccountDeployed event is sent before each UserOperationEvent that deploys a contract.
  handleAccountDeployedEvent (ev: AccountDeployedEvent): void {
    this._includedAddress(ev.args.factory)
  }

  handleUserOperationEvent (ev: UserOperationEventEvent): void {
    this._includedAddress(ev.args.sender)
    this._includedAddress(ev.args.paymaster)
    this._includedAddress(this.getEventAggregator(ev))
  }

  _includedAddress (data: string | null): void {
    if (data != null && data.length > 42) {
      const addr = data.slice(0, 42)
      this.reputationManager.updateIncludedStatus(addr)
    }
  }
}
