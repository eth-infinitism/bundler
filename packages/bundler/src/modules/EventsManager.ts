import { EntryPoint, AccountDeployedEvent, UserOperationEventEvent, SignatureAggregatorChangedEvent } from '@account-abstraction/utils/dist/src/ContractTypes'

import { ReputationManager } from './ReputationManager'
import Debug from 'debug'
import { MempoolManager } from './MempoolManager'
import { JsonRpcProvider } from 'ethers'

const debug = Debug('aa.events')

/**
 * listen to events. trigger ReputationManager's Included
 */
export class EventsManager {
  lastBlock?: number

  provider: JsonRpcProvider

  constructor (
    readonly entryPoint: EntryPoint,
    readonly mempoolManager: MempoolManager,
    readonly reputationManager: ReputationManager) {
    this.provider = entryPoint.runner as JsonRpcProvider
  }

  /**
   * automatically listen to all UserOperationEvent events
   */
  initEventListener (): void {
    void this.entryPoint.on(this.entryPoint.filters.UserOperationEvent(), (...args) => {
      const ev = args.slice(-1)[0]
      void this.handleEvent(ev as any)
    })
  }

  /**
   * process all new events since last run
   */
  async handlePastEvents (): Promise<void> {
    if (this.lastBlock === undefined) {
      this.lastBlock = Math.max(1, await this.provider.getBlockNumber() - 1000)
    }
    const events = await this.entryPoint.queryFilter('*' as any, this.lastBlock)
    for (const ev of events) {
      this.handleEvent(ev)
    }
  }

  handleEvent (ev: UserOperationEventEvent.Log | AccountDeployedEvent.Log | SignatureAggregatorChangedEvent.Log): void {
    switch (ev.eventName) {
      case 'UserOperationEvent':
        this.handleUserOperationEvent(ev as any)
        break
      case 'AccountDeployed':
        this.handleAccountDeployedEvent(ev as any)
        break
      case 'SignatureAggregatorForUserOperations':
        this.handleAggregatorChangedEvent(ev as any)
        break
    }
    this.lastBlock = ev.blockNumber + 1
  }

  handleAggregatorChangedEvent (ev: SignatureAggregatorChangedEvent.Log): void {
    debug('handle ', ev.eventName, ev.args.aggregator)
    this.eventAggregator = ev.args.aggregator
    this.eventAggregatorTxHash = ev.transactionHash
  }

  eventAggregator: string | null = null
  eventAggregatorTxHash: string | null = null

  // aggregator event is sent once per events bundle for all UserOperationEvents in this bundle.
  // it is not sent at all if the transaction is handleOps
  getEventAggregator (ev: UserOperationEventEvent.Log): string | null {
    if (ev.transactionHash !== this.eventAggregatorTxHash) {
      this.eventAggregator = null
      this.eventAggregatorTxHash = ev.transactionHash
    }
    return this.eventAggregator
  }

  // AccountDeployed event is sent before each UserOperationEvent that deploys a contract.
  handleAccountDeployedEvent (ev: AccountDeployedEvent.Log): void {
    this._includedAddress(ev.args.factory)
  }

  handleUserOperationEvent (ev: UserOperationEventEvent.Log): void {
    const hash = ev.args.userOpHash
    this.mempoolManager.removeUserOp(hash)
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
