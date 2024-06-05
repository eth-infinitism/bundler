import Debug from 'debug'
import { BigNumber, BigNumberish } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'

import {
  getRIP7560TransactionHash,
  IEntryPoint, OperationBase,
  OperationRIP7560,
  StorageMap
} from '@account-abstraction/utils'
import { IValidationManager } from '@account-abstraction/validation-manager'

import { IBundleManager } from './IBundleManager'
import { MempoolManager } from './MempoolManager'
import { ReputationManager } from './ReputationManager'
import { BundleManager, SendBundleReturn } from './BundleManager'
import { EventsManager } from './EventsManager'

const debug = Debug('aa.exec.cron')

export class BundleManagerRIP7560 extends BundleManager implements IBundleManager {
  sentBundles: SendBundleReturn[] = []
  lastScannedBlock: number = 0

  constructor (
    _entryPoint: IEntryPoint | undefined,
    readonly eventsManager: EventsManager,
    readonly mempoolManager: MempoolManager,
    readonly validationManager: IValidationManager,
    readonly reputationManager: ReputationManager,
    readonly beneficiary: string,
    readonly minSignerBalance: BigNumberish,
    readonly maxBundleGas: number,
    readonly conditionalRpc: boolean,
    readonly mergeToAccountRootHash: boolean = false,
    readonly provider: JsonRpcProvider
  ) {
    super(
      _entryPoint, eventsManager, mempoolManager, validationManager,
      reputationManager, beneficiary, minSignerBalance, maxBundleGas,
      conditionalRpc, mergeToAccountRootHash
    )
    this.provider = provider
  }

  async sendNextBundle (): Promise<SendBundleReturn | undefined> {
    await this.handlePastEvents()

    const [bundle] = await this.createBundle()
    if (bundle.length === 0) {
      debug('sendNextBundle - no bundle to send')
    } else {
      return await this.sendBundle(bundle, '', {})
    }
  }

  async handlePastEvents (): Promise<any> {
    const bundlesToClear: string[] = []
    for (const bundle of this.sentBundles) {
      // TODO: apply reputation changes based on the Bundle Stats API response
      const bundleStats = await this.provider.send('eth_getRip7560BundleStatus', [bundle.transactionHash])
      if (bundleStats != null) {
        bundlesToClear.push(bundle.transactionHash)
      }

      for (const operationHash of bundle.userOpHashes) {
        this.mempoolManager.removeUserOp(operationHash)
      }
    }
    for (const bundleId of bundlesToClear) {
      this.sentBundles = this.sentBundles.filter(it => it.transactionHash !== bundleId)
    }
  }

  async sendBundle (userOps: OperationBase[], _beneficiary: string, _storageMap: StorageMap): Promise<any> {
    const creationBlock = await this.provider.getBlockNumber()
    const bundlerId = 'www.reference-bundler.fake'
    const userOpHashes: string[] = []
    console.log('_sendBundle size:', userOps.length)
    for (const transaction of userOps) {
      userOpHashes.push(getRIP7560TransactionHash(transaction as OperationRIP7560))
    }
    // const transactions = userOps.map(convertToGethNames)
    const bundleHash = await this.provider.send('eth_sendRip7560TransactionsBundle', [
      userOps, creationBlock + 1, bundlerId
    ])
    console.log('eth_sendRip7560TransactionsBundle bundleHash = ', bundleHash)
    this.sentBundles.push({
      transactionHash: bundleHash,
      userOpHashes
    })
    return bundleHash
  }

  async getPaymasterBalance (paymaster: string): Promise<BigNumber> {
    return await this.provider.getBalance(paymaster)
  }
}
