import { ExecutionManager } from './modules/ExecutionManager'
import { ReputationDump, ReputationManager } from './modules/ReputationManager'
import { MempoolManager } from './modules/MempoolManager'
import { SendBundleReturn } from './modules/BundleManager'
import { EventsManager } from './modules/EventsManager'

export class DebugMethodHandler {
  constructor (
    readonly execManager: ExecutionManager,
    readonly eventsManager: EventsManager,
    readonly repManager: ReputationManager,
    readonly mempoolMgr: MempoolManager
  ) {
  }

  setBundlingMode (mode: 'manual' | 'auto'): void {
    this.setBundleInterval(mode)
  }

  setBundleInterval (interval: number | 'manual' | 'auto', maxPoolSize = 100): void {
    if (interval == null) {
      throw new Error('must specify interval <number>|manual|auto')
    }
    if (interval === 'auto') {
      // size=0 ==> auto-bundle on each userop
      this.execManager.setAutoBundler(0, 0)
    } else if (interval === 'manual') {
      // interval=0, but never auto-mine
      this.execManager.setAutoBundler(0, 1000)
    } else {
      this.execManager.setAutoBundler(interval, maxPoolSize)
    }
  }

  async sendBundleNow (): Promise<SendBundleReturn | undefined> {
    const ret = await this.execManager.attemptBundle(true)
    // handlePastEvents is performed before processing the next bundle.
    // however, in debug mode, we are interested in the side effects
    // (on the mempool) of this "sendBundle" operation
    await this.eventsManager.handlePastEvents()
    return ret
  }

  clearState (): void {
    this.mempoolMgr.clearState()
    this.repManager.clearState()
  }

  async dumpMempool (): Promise<any> {
    return this.mempoolMgr.dump()
  }

  setReputation (param: any): ReputationDump {
    if (param.reputation == null) {
      throw new Error('expected structure { reputation: {addr:{opsSeen:1, opsIncluded:2} }')
    }
    return this.repManager.setReputation(param)
  }

  dumpReputation (): ReputationDump {
    return this.repManager.dump()
  }
}
