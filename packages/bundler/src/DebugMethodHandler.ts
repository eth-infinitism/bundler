import ow from 'ow'

import { StakeInfo } from '@account-abstraction/utils'

import { BundlerConfig } from './BundlerConfig'
import { EventsManager } from './modules/EventsManager'
import { ExecutionManager } from './modules/ExecutionManager'
import { MempoolManager } from './modules/MempoolManager'
import { ReputationDump, ReputationManager } from './modules/ReputationManager'
import { SendBundleReturn } from './modules/BundleManager'
import { PreVerificationGasCalculator } from '@account-abstraction/sdk'

/**
 * Only parameters in this object can be provided by a 'debug_bundler_setConfiguration' API.
 */
export const BundlerConfigShape = {
  fixedGasOverhead: ow.optional.number,
  perUserOpGasOverhead: ow.optional.number,
  perUserOpWordGasOverhead: ow.optional.number,
  zeroByteGasCost: ow.optional.number,
  nonZeroByteGasCost: ow.optional.number,
  expectedBundleSize: ow.optional.number,
  estimationSignatureSize: ow.optional.number,
  estimationPaymasterDataSize: ow.optional.number
}

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

  clearMempool (): void {
    this.mempoolMgr.clearState()
  }

  setReputation (param: any): ReputationDump {
    return this.repManager.setReputation(param)
  }

  dumpReputation (): ReputationDump {
    return this.repManager.dump()
  }

  clearReputation (): void {
    this.repManager.clearState()
  }

  async getStakeStatus (
    address: string,
    entryPoint: string
  ): Promise<{
      stakeInfo: StakeInfo
      isStaked: boolean
    }> {
    return await this.repManager.getStakeStatus(address, entryPoint)
  }

  async _setConfiguration (config: Partial<BundlerConfig>): Promise<PreVerificationGasCalculator> {
    ow.object.exactShape(BundlerConfigShape)
    return await this.execManager._setConfiguration(config)
  }
}
