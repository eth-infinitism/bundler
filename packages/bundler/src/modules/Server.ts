import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from './ValidationManager'
import { EntryPoint__factory } from '@account-abstraction/contracts'
import { parseEther } from 'ethers/lib/utils'
import { UserOperation } from './moduleUtils'
import { Signer } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'

class Server {
  private readonly execMgr: ExecutionManager
  private readonly eventsMgr: EventsManager

  constructor (config: BundlerConfig, signer: Signer) {
    const entryPoint = EntryPoint__factory.connect(config.entryPoint, signer)
    const repMgr = new ReputationManager(BundlerReputationParams)
    const mempoolMgr = new MempoolManager(repMgr)
    const validMgr = new ValidationManager(entryPoint, repMgr, parseEther(config.minStake), config.minUnstakeDelay)
    const bundleMgr = new BundleManager(entryPoint, mempoolMgr, validMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
    this.eventsMgr = new EventsManager(entryPoint, repMgr)
    this.execMgr = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)

    this.execMgr.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)
  }

  async handleUserOp (userOp: UserOperation, entryPointInput: string): Promise<void> {
    await this.execMgr.sendUserOperation(userOp, entryPointInput)
  }

  /**
   * manually update reputation based on past events
   */
  async handleEvents (): Promise<void> {
    await this.eventsMgr.handlePastEvents()
  }
}
