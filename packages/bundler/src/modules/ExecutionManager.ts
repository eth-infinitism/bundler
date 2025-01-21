import Debug from 'debug'
import { Mutex } from 'async-mutex'
import { EIP7702Authorization, OperationBase, StorageMap } from '@account-abstraction/utils'
import { clearInterval } from 'timers'

import { SendBundleReturn } from './BundleManager'
import { MempoolManager } from './MempoolManager'
import { ReputationManager } from './ReputationManager'
import { IBundleManager } from './IBundleManager'
import {
  EmptyValidateUserOpResult,
  IValidationManager, ValidationManager
} from '@account-abstraction/validation-manager'
import { DepositManager } from './DepositManager'
import { BigNumberish, Signer } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'
import { PreVerificationGasCalculator } from '@account-abstraction/sdk'
import { ERC7562Parser } from '@account-abstraction/validation-manager/dist/src/ERC7562Parser'

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
    private readonly bundleManager: IBundleManager,
    private validationManager: IValidationManager,
    private readonly depositManager: DepositManager,
    private readonly signer: Signer,
    private readonly rip7560: boolean,
    private readonly useRip7560Mode: string | undefined,
    private readonly gethDevMode: boolean
  ) {
  }

  /**
   * send a user operation through the bundler.
   * @param userOp the UserOp to send.
   * @param entryPointInput the entryPoint passed through the RPC request.
   * @param skipValidation if set to true we will not perform tracing and ERC-7562 rules compliance validation
   */
  async sendUserOperation (
    userOp: OperationBase,
    entryPointInput: string,
    skipValidation: boolean
  ): Promise<void> {
    await this.mutex.runExclusive(async () => {
      debug('sendUserOperation')
      this.validationManager.validateInputParameters(userOp, entryPointInput)
      let validationResult = EmptyValidateUserOpResult
      if (!skipValidation) {
        validationResult = await this.validationManager.validateUserOp(userOp)
      }
      const userOpHash = await this.validationManager.getOperationHash(userOp)
      await this.depositManager.checkPaymasterDeposit(userOp)
      this.mempoolManager.addUserOp(
        skipValidation,
        userOp,
        userOpHash,
        validationResult)
      if (!this.rip7560 || (this.rip7560 && this.useRip7560Mode === 'PUSH')) {
        await this.attemptBundle(false)
      }
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
    if (this.rip7560 && this.useRip7560Mode === 'PULL' && this.gethDevMode && force) {
      debug('sending 1 wei transaction')
      const result = await this.signer.sendTransaction({
        to: this.signer.getAddress(),
        value: 1
      })
      // wait up to 2 seconds for the transaction to be mined
      for (let i = 0; ; i++) {
        const rcpt = await this.signer.provider?.getTransactionReceipt(result.hash)
        if (rcpt != null) {
          break
        }
        if (i > 20) {
          throw new Error('timed out waiting for transaction')
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      await this.bundleManager.handlePastEvents()
      return
    }
    debug('attemptBundle force=', force, 'count=', this.mempoolManager.count(), 'max=', this.maxMempoolSize)
    if (force || this.mempoolManager.count() >= this.maxMempoolSize) {
      const ret = await this.bundleManager.sendNextBundle()
      if (this.maxMempoolSize === 0) {
        // in "auto-bundling" mode (which implies auto-mining) also flush mempool from included UserOps
        await this.bundleManager.handlePastEvents()
      }
      this.depositManager.clearCache()
      return ret
    }
  }

  async createBundle (
    minBaseFee: BigNumberish,
    maxBundleGas: BigNumberish,
    maxBundleSize: BigNumberish
  ): Promise<[OperationBase[], EIP7702Authorization[], StorageMap]> {
    return await this.bundleManager.createBundle(minBaseFee, maxBundleGas, maxBundleSize)
  }

  async _setConfiguration (configOverrides: Partial<BundlerConfig>): Promise<PreVerificationGasCalculator> {
    const { configuration, entryPoint, unsafe } = this.validationManager._getDebugConfiguration()
    const mergedConfiguration = Object.assign({}, configuration, configOverrides)
    const pvgc = new PreVerificationGasCalculator(mergedConfiguration)
    const erc7562Parser = new ERC7562Parser(entryPoint.address, mergedConfiguration.senderCreator ?? '')
    this.validationManager = new ValidationManager(
      entryPoint,
      unsafe,
      pvgc,
      erc7562Parser
    )
    return pvgc
  }
}
