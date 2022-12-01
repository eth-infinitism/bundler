import { ReputationManager } from './ReputationManager'
import { time } from '@nomicfoundation/hardhat-network-helpers'
import { clearInterval } from 'timers'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import Debug from 'debug'
import { UserOperation } from './moduleUtils'
import { ValidationManager } from './ValidationManager'

const debug = Debug('aa.exec')

/**
 * execute userOps manually or using background timer.
 * This is the top-level interface to send UserOperation
 */
export class ExecutionManager {
  reputationCron: any
  autoBundleInterval: any
  private maxMempoolSize = 10
  private autoInterval = 0

  constructor (private reputationManager: ReputationManager,
    private mempoolManager: MempoolManager,
    private bundleManager: BundleManager,
    private validationManager: ValidationManager
  ) {
  }

  /**
   * send a user operation through the bundler.
   * @param userOp the UserOp to send.
   */
  async sendUserOperation (userOp: UserOperation, entryPointInput: string) {
    this.validationManager.validateInputParameters(userOp, entryPointInput)
    const validationResult = await this.validationManager.validateUserOp(userOp)
    this.mempoolManager.addUserOp(userOp, validationResult.prefund, validationResult.aggregatorInfo?.actualAggregator)
    this.attemptBundle()
  }

  setReputationCorn (interval: number) {
    debug('set reputation interval to', interval)
    clearInterval(this.reputationCron)
    if (interval != 0) {
      this.reputationCron = setInterval(() => this.reputationManager.hourlyCron(), interval)
    }
  }

  /**
   * set automatic bundle creation
   * @param interval interval to check. send bundle anyway after this time is elapsed. zero for manual mode
   * @param maxSize maximum # of pending mempool entities. send immediately when there are that many entities in the mempool.
   *    set to zero (or 1) to automatically send each UserOp.
   * (note: there is a chance that the sent bundle will contain less than this number, in case only some mempool entities can be sent.
   *  e.g. throttled paymaster)
   */
  setAutoBundler (interval: number, maxSize: number) {
    debug('set auto-bundle interval=', interval, 'maxSize=', maxSize)
    clearInterval(this.autoBundleInterval)
    this.autoInterval = interval
    if (interval != 0) {
      this.autoBundleInterval = setInterval(this.attemptBundle.bind(this), interval)
    }
    this.maxMempoolSize = maxSize
    this.attemptBundle()
  }

  /**
   * attempt to send a bundle now.
   * @param force
   */
  attemptBundle () {
    if (this.mempoolManager.count() >= this.maxMempoolSize) {
      void this.bundleManager.sendNextBundle()
    }
  }

}
