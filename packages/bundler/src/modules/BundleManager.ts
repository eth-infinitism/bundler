import { EntryPoint } from '@account-abstraction/contracts'
import { MempoolManager } from './MempoolManager'
import { IValidationManager } from '@account-abstraction/validation-manager'
import { BigNumber, BigNumberish } from 'ethers'
import { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers'
import Debug from 'debug'
import { ReputationManager } from './ReputationManager'
import { Mutex } from 'async-mutex'
import { GetUserOpHashes__factory } from '../types'
import {
  UserOperation,
  StorageMap,
  runContractScript,
  packUserOp
} from '@account-abstraction/utils'
import { EventsManager } from './EventsManager'
import { ErrorDescription } from '@ethersproject/abi/lib/interface'
import { IBundleManager } from './IBundleManager'
import { BaseBundleManager } from './BaseBundleManager'

const debug = Debug('aa.exec.cron')


export interface SendBundleReturn {
  transactionHash: string
  userOpHashes: string[]
}

export class BundleManager extends BaseBundleManager implements IBundleManager {
  provider: JsonRpcProvider
  signer: JsonRpcSigner
  mutex = new Mutex()

  constructor (
    readonly entryPoint: EntryPoint,
    readonly eventsManager: EventsManager,
    mempoolManager: MempoolManager,
    validationManager: IValidationManager,
    reputationManager: ReputationManager,
    readonly beneficiary: string,
    readonly minSignerBalance: BigNumberish,
    maxBundleGas: number,
    // use eth_sendRawTransactionConditional with storage map
    readonly conditionalRpc: boolean,
    // in conditionalRpc: always put root hash (not specific storage slots) for "sender" entries
    readonly mergeToAccountRootHash: boolean = false
  ) {
    super(mempoolManager, validationManager, reputationManager, maxBundleGas)
    this.provider = entryPoint.provider as JsonRpcProvider
    this.signer = entryPoint.signer as JsonRpcSigner
  }

  /**
   * attempt to send a bundle:
   * collect UserOps from mempool into a bundle
   * send this bundle.
   */
  async sendNextBundle (): Promise<SendBundleReturn | undefined> {
    return await this.mutex.runExclusive(async () => {
      debug('sendNextBundle')

      // first flush mempool from already-included UserOps, by actively scanning past events.
      await this.handlePastEvents()

      const [bundle, storageMap] = await this._createBundle()
      if (bundle.length === 0) {
        debug('sendNextBundle - no bundle to send')
      } else {
        const beneficiary = await this._selectBeneficiary()
        const ret = await this.sendBundle(bundle as UserOperation[], beneficiary, storageMap)
        debug(`sendNextBundle exit - after sent a bundle of ${bundle.length} `)
        return ret
      }
    })
  }

  async handlePastEvents (): Promise<void> {
    await this.eventsManager.handlePastEvents()
  }

  /**
   * submit a bundle.
   * after submitting the bundle, remove all UserOps from the mempool
   * @return SendBundleReturn the transaction and UserOp hashes on successful transaction, or null on failed transaction
   */
  async sendBundle (userOps: UserOperation[], beneficiary: string, storageMap: StorageMap): Promise<SendBundleReturn | undefined> {
    try {
      const feeData = await this.provider.getFeeData()
      const tx = await this.entryPoint.populateTransaction.handleOps(userOps.map(packUserOp), beneficiary, {
        type: 2,
        nonce: await this.signer.getTransactionCount(),
        gasLimit: 10e6,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
        maxFeePerGas: feeData.maxFeePerGas ?? 0
      })
      tx.chainId = this.provider._network.chainId
      const signedTx = await this.signer.signTransaction(tx)
      let ret: string
      if (this.conditionalRpc) {
        debug('eth_sendRawTransactionConditional', storageMap)
        ret = await this.provider.send('eth_sendRawTransactionConditional', [
          signedTx, { knownAccounts: storageMap }
        ])
        debug('eth_sendRawTransactionConditional ret=', ret)
      } else {
        // ret = await this.signer.sendTransaction(tx)
        ret = await this.provider.send('eth_sendRawTransaction', [signedTx])
        debug('eth_sendRawTransaction ret=', ret)
      }
      // TODO: parse ret, and revert if needed.
      debug('ret=', ret)
      debug('sent handleOps with', userOps.length, 'ops. removing from mempool')
      // hashes are needed for debug rpc only.
      const hashes = await this.getUserOpHashes(userOps)
      return {
        transactionHash: ret,
        userOpHashes: hashes
      }
    } catch (e: any) {
      let parsedError: ErrorDescription
      try {
        parsedError = this.entryPoint.interface.parseError((e.data?.data ?? e.data))
      } catch (e1) {
        this.checkFatal(e)
        console.warn('Failed handleOps, but non-FailedOp error', e)
        return
      }
      const {
        opIndex,
        reason
      } = parsedError.args
      const userOp = userOps[opIndex]
      const reasonStr: string = reason.toString()
      if (reasonStr.startsWith('AA3')) {
        this.reputationManager.crashedHandleOps(userOp.paymaster)
      } else if (reasonStr.startsWith('AA2')) {
        this.reputationManager.crashedHandleOps(userOp.sender)
      } else if (reasonStr.startsWith('AA1')) {
        this.reputationManager.crashedHandleOps(userOp.factory)
      } else {
        this.mempoolManager.removeUserOp(userOp)
        console.warn(`Failed handleOps sender=${userOp.sender} reason=${reasonStr}`)
      }
    }
  }

  // fatal errors we know we can't recover
  checkFatal (e: any): void {
    // console.log('ex entries=',Object.entries(e))
    if (e.error?.code === -32601) {
      throw e
    }
  }

  async getPaymasterBalance (paymaster: string): Promise<BigNumber>{
    return await this.entryPoint.balanceOf(paymaster)
  }

  /**
   * determine who should receive the proceedings of the request.
   * if signer's balance is too low, send it to signer. otherwise, send to configured beneficiary.
   */
  async _selectBeneficiary (): Promise<string> {
    const currentBalance = await this.provider.getBalance(this.signer.getAddress())
    let beneficiary = this.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.minSignerBalance)) {
      beneficiary = await this.signer.getAddress()
      console.log('low balance. using ', beneficiary, 'as beneficiary instead of ', this.beneficiary)
    }
    return beneficiary
  }

  // helper function to get hashes of all UserOps
  async getUserOpHashes (userOps: UserOperation[]): Promise<string[]> {
    const { userOpHashes } = await runContractScript(this.entryPoint.provider,
      new GetUserOpHashes__factory(),
      [this.entryPoint.address, userOps.map(packUserOp)])

    return userOpHashes
  }
}
