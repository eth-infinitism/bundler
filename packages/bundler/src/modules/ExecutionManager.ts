import { ReputationManager } from './ReputationManager'
import { clearInterval } from 'timers'
import { MempoolManager } from './MempoolManager'
import { BundleManager, SendBundleReturn } from './BundleManager'
import Debug from 'debug'
import { ValidationManager } from './ValidationManager'
import { Mutex } from 'async-mutex'
import { UserOperation } from './Types'

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
      const validationResult = await this.validationManager.validateUserOp(userOp, undefined)
      const userOpHash = await this.validationManager.entryPoint.getUserOpHash(userOp)
      this.mempoolManager.addUserOp(userOp,
        userOpHash,
        validationResult.returnInfo.prefund,
        validationResult.senderInfo,
        validationResult.referencedContracts,
        validationResult.aggregatorInfo?.addr)
      await this.attemptBundle(false)
    })
  }

  setReputationCron (interval: number): void {
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
        void this.attemptBundle(true).catch(e => console.error('auto-bundle failed', e))
      }, autoBundleInterval * 1000)
    }
    this.maxMempoolSize = maxMempoolSize
  }

  /**
   * attempt to send a bundle now.
   * @param force
   */
  async attemptBundle (force = true): Promise<SendBundleReturn | undefined> {
    debug('attemptBundle force=', force, 'count=', this.mempoolManager.count(), 'max=', this.maxMempoolSize)
    if (force || this.mempoolManager.count() >= this.maxMempoolSize) {
      const ret = await this.bundleManager.sendNextBundle()
      if (this.maxMempoolSize === 0) {
        // in "auto-bundling" mode (which implies auto-mining) also flush mempool from included UserOps
        await this.bundleManager.handlePastEvents()
      }
      return ret
    }
  }
}
