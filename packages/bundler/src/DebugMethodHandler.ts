import { ExecutionManager } from './modules/ExecutionManager'
import { ReputationDump, ReputationManager } from './modules/ReputationManager'
import { MempoolManager } from './modules/MempoolManager'

export class DebugMethodHandler {
  constructor (
    readonly execManager: ExecutionManager,
    readonly repManager: ReputationManager,
    readonly mempoolMgr: MempoolManager
  ) {
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

  async sendBundleNow (): Promise<void> {
    await this.execManager.attemptBundle(true)
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
