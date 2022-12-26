import { ReputationManager } from './ReputationManager'
import { clearInterval } from 'timers'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import Debug from 'debug'
import { UserOperation } from './moduleUtils'
import { ValidationManager } from './ValidationManager'
import { Mutex } from 'async-mutex'

const debug = Debug('aa.exec')

/**
 * execute userOps manually or using background timer.
 * This is the top-level interface to send UserOperation
 */
export class ExecutionManager {
  private reputationCron: any
  private autoBundleInterval: any
  private maxMempoolSize = 0 // default to auto-mining
  private autoInterval = 0
  private readonly mutex = new Mutex()

  constructor (private readonly reputationManager: ReputationManager,
    private readonly mempoolManager: MempoolManager,
    private readonly bundleManager: BundleManager,
    private readonly validationManager: ValidationManager
  ) {
  }

  /**
   * send a user operation through the bundler.
   * @param userOp the UserOp to send.
   */
  async sendUserOperation (userOp: UserOperation, entryPointInput: string): Promise<void> {
    await this.mutex.runExclusive(async () => {
      debug('sendUserOperation')
      this.validationManager.validateInputParameters(userOp, entryPointInput)
      const validationResult = await this.validationManager.validateUserOp(userOp)
      this.mempoolManager.addUserOp(userOp, validationResult.returnInfo.prefund, validationResult.aggregatorInfo?.addr)
      await this.attemptBundle(false)
    })
  }

  setReputationCorn (interval: number): void {
    debug('set reputation interval to', interval)
    clearInterval(this.reputationCron)
    if (interval !== 0) {
      this.reputationCron = setInterval(() => this.reputationManager.hourlyCron(), interval)
    }
  }

  /**
   * set automatic bundle creation
   * @param autoBundleInterval autoBundleInterval to check. send bundle anyway after this time is elapsed. zero for manual mode
   * @param maxMempoolSize maximum # of pending mempool entities. send immediately when there are that many entities in the mempool.
   *    set to zero (or 1) to automatically send each UserOp.
   * (note: there is a chance that the sent bundle will contain less than this number, in case only some mempool entities can be sent.
   *  e.g. throttled paymaster)
   */
  setAutoBundler (autoBundleInterval: number, maxMempoolSize: number): void {
    debug('set auto-bundle autoBundleInterval=', autoBundleInterval, 'maxMempoolSize=', maxMempoolSize)
    clearInterval(this.autoBundleInterval)
    this.autoInterval = autoBundleInterval
    if (autoBundleInterval !== 0) {
      this.autoBundleInterval = setInterval(() => {
        void this.attemptBundle(true)
      }, autoBundleInterval * 1000)
    }
    this.maxMempoolSize = maxMempoolSize
  }

  /**
   * attempt to send a bundle now.
   * @param force
   */
  async attemptBundle (force = true): Promise<void> {
    debug('attemptBundle force=', force, 'count=', this.mempoolManager.count(), 'max=', this.maxMempoolSize)
    if (force || this.mempoolManager.count() >= this.maxMempoolSize) {
      await this.bundleManager.sendNextBundle()
    }
  }
}
