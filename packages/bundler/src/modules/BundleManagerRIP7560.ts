import Debug from 'debug'
import { BigNumber, BigNumberish, ethers, Signer } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import { RLP } from '@ethereumjs/rlp'
import { hexlify } from 'ethers/lib/utils'

import {
  EIP7702Authorization,
  OperationBase,
  OperationRIP7560,
  StorageMap,
  getRIP7560TransactionHash
} from '@account-abstraction/utils'
import { IValidationManager } from '@account-abstraction/validation-manager'

import { BundleManager, SendBundleReturn } from './BundleManager'
import { EventsManager } from './EventsManager'
import { MempoolManager } from './MempoolManager'
import { ReputationManager } from './ReputationManager'

const debug = Debug('aa.exec.cron')

export class BundleManagerRIP7560 extends BundleManager {
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
    mergeToAccountRootHash: boolean
  ) {
    super(
      undefined, provider, signer, eventsManager, mempoolManager, validationManager,
      reputationManager, beneficiary, minSignerBalance, maxBundleGas,
      conditionalRpc, mergeToAccountRootHash
    )
  }

  async sendNextBundle (): Promise<SendBundleReturn | undefined> {
    await this.handlePastEvents()

    // TODO: pass correct bundle limit parameters!
    const [bundle] = await this.createBundle(0, 0, 0)
    if (bundle.length === 0) {
      debug('sendNextBundle - no bundle to send')
    } else {
      return await this.sendBundle(bundle, [], '', {})
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

  /**
   *
   * @param minBaseFee
   * @param maxBundleGas
   * @param maxBundleSize
   * @return An array of transactions included in the bundle.
   * @return The EIP7702Authorization array is always empty as each individual RIP-7560 transaction performs its own authorizations.
   */
  async createBundle (
    minBaseFee: BigNumberish,
    maxBundleGas: BigNumberish,
    maxBundleSize: BigNumberish
  ): Promise<[OperationBase[], EIP7702Authorization[], StorageMap]> {
    const [bundle, , storageMap] = await super.createBundle(minBaseFee, maxBundleGas, maxBundleSize)
    if (bundle.length === 0) {
      return [[], [], {}]
    }
    const bundleHash = this.computeBundleHash(bundle)

    // TODO: deduplicate this code with the PUSH method
    const userOpHashes: string[] = []
    for (const transaction of bundle) {
      userOpHashes.push(getRIP7560TransactionHash(transaction as OperationRIP7560))
    }
    this.sentBundles.push({
      transactionHash: bundleHash,
      userOpHashes
    })

    return [bundle, [], storageMap]
  }

  async sendBundle (userOps: OperationBase[], _eip7702Tuples: EIP7702Authorization[], _beneficiary: string, _storageMap: StorageMap): Promise<any> {
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

  private computeBundleHash (userOps: OperationBase[]): string {
    const txids: string[] = []
    for (const userOp of userOps) {
      txids.push(getRIP7560TransactionHash(userOp as OperationRIP7560))
    }
    const bundleRlpEncoding = RLP.encode(txids)
    const bundleHash = ethers.utils.keccak256(bundleRlpEncoding)
    console.log('computeBundleHash', txids, hexlify(bundleHash))
    return hexlify(bundleHash)
  }
}
