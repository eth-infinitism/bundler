import { mergeStorageMap, StorageMap, BaseOperation } from '@account-abstraction/utils'
import { BigNumber, BigNumberish } from 'ethers'
import Debug from 'debug'

import { ValidateUserOpResult, IValidationManager } from '@account-abstraction/validation-manager'

import { ReputationManager, ReputationStatus } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { IBundleManager } from './IBundleManager'

const debug = Debug('aa.exec.cron')

const THROTTLED_ENTITY_BUNDLE_COUNT = 4

export abstract class BaseBundleManager implements IBundleManager {
  protected constructor (
    readonly mempoolManager: MempoolManager,
    readonly validationManager: IValidationManager,
    readonly reputationManager: ReputationManager,
    readonly maxBundleGas: number
  ) {}

  abstract sendNextBundle (): Promise<any>

  abstract handlePastEvents (): Promise<void>

  abstract getPaymasterBalance (paymaster: string): Promise<BigNumber>

  async _validatePaymasterBalanceSufficient (
    paymaster: string,
    requiredBalance: BigNumberish,
    paymasterDeposit: { [paymaster: string]: BigNumber },
    stakedEntityCount: { [addr: string]: number }
  ): Promise<boolean> {
    if (paymasterDeposit[paymaster] == null) {
      paymasterDeposit[paymaster] = await this.getPaymasterBalance(paymaster)
    }
    if (paymasterDeposit[paymaster].lt(requiredBalance)) {
      return false
    }
    stakedEntityCount[paymaster] = (stakedEntityCount[paymaster] ?? 0) + 1
    paymasterDeposit[paymaster] = paymasterDeposit[paymaster].sub(requiredBalance)
    return true
  }

  async _createBundle (): Promise<[BaseOperation[], StorageMap]> {
    const entries = this.mempoolManager.getSortedForInclusion()
    const bundle: BaseOperation[] = []

    // paymaster deposit should be enough for all UserOps in the bundle.
    const paymasterDeposit: { [paymaster: string]: BigNumber } = {}
    // throttled paymasters and deployers are allowed only small UserOps per bundle.
    const stakedEntityCount: { [addr: string]: number } = {}
    // each sender is allowed only once per bundle
    const senders = new Set<string>()

    // all entities that are known to be valid senders in the mempool
    const knownSenders = this.mempoolManager.getKnownSenders()

    const storageMap: StorageMap = {}
    let totalGas = BigNumber.from(0)
    debug('got mempool of ', entries.length)
    // eslint-disable-next-line no-labels
    mainLoop:
      for (const entry of entries) {
        const paymaster = entry.userOp.paymaster
        const factory = entry.userOp.factory
        const paymasterStatus = this.reputationManager.getStatus(paymaster)
        const deployerStatus = this.reputationManager.getStatus(factory)
        if (paymasterStatus === ReputationStatus.BANNED || deployerStatus === ReputationStatus.BANNED) {
          this.mempoolManager.removeUserOp(entry.userOp)
          continue
        }
        // [SREP-030]
        if (paymaster != null && (paymasterStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[paymaster] ?? 0) > THROTTLED_ENTITY_BUNDLE_COUNT)) {
          debug('skipping throttled paymaster', entry.userOp.sender, entry.userOp.nonce)
          continue
        }
        // [SREP-030]
        if (factory != null && (deployerStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[factory] ?? 0) > THROTTLED_ENTITY_BUNDLE_COUNT)) {
          debug('skipping throttled factory', entry.userOp.sender, entry.userOp.nonce)
          continue
        }
        if (senders.has(entry.userOp.sender)) {
          debug('skipping already included sender', entry.userOp.sender, entry.userOp.nonce)
          // allow only a single UserOp per sender per bundle
          continue
        }
        let validationResult: ValidateUserOpResult
        try {
          // re-validate UserOp. no need to check stake, since it cannot be reduced between first and 2nd validation
          validationResult = await this.validationManager.validateOperation(entry.userOp, entry.referencedContracts)
        } catch (e: any) {
          debug('failed 2nd validation:', e.message)
          // failed validation. don't try anymore
          this.mempoolManager.removeUserOp(entry.userOp)
          continue
        }

        for (const storageAddress of Object.keys(validationResult.storageMap)) {
          if (
            storageAddress.toLowerCase() !== entry.userOp.sender.toLowerCase() &&
            knownSenders.includes(storageAddress.toLowerCase())
          ) {
            console.debug(`UserOperation from ${entry.userOp.sender} sender accessed a storage of another known sender ${storageAddress}`)
            // eslint-disable-next-line no-labels
            continue mainLoop
          }
        }

        // todo: we take UserOp's callGasLimit, even though it will probably require less (but we don't
        // attempt to estimate it to check)
        // which means we could "cram" more UserOps into a bundle.
        const userOpGasCost = BigNumber.from(validationResult.returnInfo.preOpGas).add(entry.userOp.callGasLimit)
        const newTotalGas = totalGas.add(userOpGasCost)
        if (newTotalGas.gt(this.maxBundleGas)) {
          break
        }

        if (paymaster != null) {
          const isSufficient = await this._validatePaymasterBalanceSufficient(
            paymaster,
            validationResult.returnInfo.prefund,
            paymasterDeposit,
            stakedEntityCount
          )
          if (!isSufficient) {
            // not enough balance in paymaster to pay for all UserOps
            // (but it passed validation, so it can sponsor them separately
            continue
          }
        }
        if (factory != null) {
          stakedEntityCount[factory] = (stakedEntityCount[factory] ?? 0) + 1
        }

        // If sender's account already exist: replace with its storage root hash
        // TODO: UNCOMMENT THESE LINES THESE SEEM IMPORTANT
        // if (this.mergeToAccountRootHash && this.conditionalRpc && entry.userOp.factory == null) {
        //   const { storageHash } = await this.provider.send('eth_getProof', [entry.userOp.sender, [], 'latest'])
        //   storageMap[entry.userOp.sender.toLowerCase()] = storageHash
        // }
        mergeStorageMap(storageMap, validationResult.storageMap)

        senders.add(entry.userOp.sender)
        bundle.push(entry.userOp)
        totalGas = newTotalGas
      }
    return [bundle, storageMap]
  }

}

