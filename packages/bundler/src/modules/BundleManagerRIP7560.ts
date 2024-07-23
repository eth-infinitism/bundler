import Debug from 'debug'
import { BigNumber, BigNumberish, Signer } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'

import {
  OperationBase,
  OperationRIP7560,
  StorageMap,
  getRIP7560TransactionHash
} from '@account-abstraction/utils'
import { IValidationManager } from '@account-abstraction/validation-manager'

import { BundleManager, SendBundleReturn } from './BundleManager'
import { EventsManager } from './EventsManager'
import { IBundleManager } from './IBundleManager'
import { MempoolManager } from './MempoolManager'
import { ReputationManager } from './ReputationManager'

const debug = Debug('aa.exec.cron')

export class BundleManagerRIP7560 extends BundleManager implements IBundleManager {
  sentBundles: SendBundleReturn[] = []
  lastScannedBlock: number = 0

  constructor (
    provider: JsonRpcProvider,
    signer: Signer,
    eventsManager: EventsManager,
    mempoolManager: MempoolManager,
    validationManager: IValidationManager,
    reputationManager: ReputationManager,
    beneficiary: string,
    minSignerBalance: BigNumberish,
    maxBundleGas: number,
    conditionalRpc: boolean,
    mergeToAccountRootHash: boolean = false
  ) {
    super(
      undefined, provider, signer, eventsManager, mempoolManager, validationManager,
      reputationManager, beneficiary, minSignerBalance, maxBundleGas,
      conditionalRpc, mergeToAccountRootHash
    )
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
