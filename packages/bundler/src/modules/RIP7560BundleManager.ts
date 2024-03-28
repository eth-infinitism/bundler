import Debug from 'debug'
import { BigNumber } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'

import { getRIP7560TransactionHash, RIP7560Transaction } from '@account-abstraction/utils'
import { IValidationManager } from '@account-abstraction/validation-manager'

import { BaseBundleManager } from './BaseBundleManager'
import { IBundleManager } from './IBundleManager'
import { MempoolManager } from './MempoolManager'
import { ReputationManager } from './ReputationManager'
import { SendBundleReturn } from './BundleManager'

const debug = Debug('aa.exec.cron')

export class RIP7560BundleManager extends BaseBundleManager implements IBundleManager {
  sentBundles: SendBundleReturn[] = []
  lastScannedBlock: number = 0

  constructor (
    mempoolManager: MempoolManager,
    validationManager: IValidationManager,
    reputationManager: ReputationManager,
    maxBundleGas: number,
    readonly provider: JsonRpcProvider
  ) {
    super(mempoolManager, validationManager, reputationManager, maxBundleGas)
    this.provider = provider
  }

  async getPaymasterBalance (paymaster: string): Promise<BigNumber> {
    return await this.provider.getBalance(paymaster)
  }

  async sendNextBundle (): Promise<SendBundleReturn | undefined> {
    await this.handlePastEvents()

    const [bundle, storageMap] = await this._createBundle()
    if (bundle.length === 0) {
      debug('sendNextBundle - no bundle to send')
    } else {
      return this._sendBundle(bundle as RIP7560Transaction[])
    }
  }

  async handlePastEvents (): Promise<any> {
    let bundlesToClear: string[] = []
    for (const bundle of this.sentBundles) {
      // TODO: apply reputation changes based on the Bundle Stats API response
      const bundleStats = await this.provider.send('eth_getBundleStatus', [bundle.transactionHash])
      if (bundleStats != null) {
        bundlesToClear.push(bundle.transactionHash)
      }

      for (const operationHash of bundle.userOpHashes) {
        this.mempoolManager.removeUserOp(operationHash)
      }
    }
    for (const bundleId of bundlesToClear) {
      this.sentBundles = this.sentBundles.filter(it => it.transactionHash != bundleId)
    }

  }

  async _sendBundle (transactions: RIP7560Transaction[]): Promise<any> {
    const creationBlock = await this.provider.getBlockNumber()
    const expectedRevenue = 0
    const bundlerId = 'www.reference-bundler.fake'
    const userOpHashes: string[] = []
    console.log('_sendBundle size:', transactions.length)
    for (const transaction of transactions) {
      (transaction as any).gas = transaction.callGasLimit;
      (transaction as any).validationGas = transaction.verificationGasLimit;
      (transaction as any).paymasterGas = transaction.paymasterVerificationGasLimit
      userOpHashes.push(getRIP7560TransactionHash(transaction))
    }
    const bundleHash = await this.provider.send('eth_sendAATransactionsBundle', [
      transactions, creationBlock + 1, expectedRevenue, bundlerId
    ])
    console.log('eth_sendAATransactionsBundle bundleHash = ', bundleHash)
    this.sentBundles.push({
      transactionHash: bundleHash,
      userOpHashes
    })
    return bundleHash
  }
}
