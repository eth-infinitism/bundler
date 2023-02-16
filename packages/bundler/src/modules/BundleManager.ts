import { EntryPoint } from '@account-abstraction/contracts'
import { MempoolManager } from './MempoolManager'
import { ValidateUserOpResult, ValidationManager } from './ValidationManager'
import { BigNumber, BigNumberish } from 'ethers'
import { getAddr, mergeStorageMap, StorageMap, UserOperation } from './moduleUtils'
import { JsonRpcProvider, JsonRpcSigner, TransactionResponse } from '@ethersproject/providers'
import Debug from 'debug'
import { ReputationManager, ReputationStatus } from './ReputationManager'
import { AddressZero } from '@account-abstraction/utils'
import { Mutex } from 'async-mutex'
import { BundlerHelper } from '../types'

const debug = Debug('aa.exec.cron')

export interface SendBundleReturn {
  transactionHash: string
  userOpHashes: string[]
}

export class BundleManager {
  provider: JsonRpcProvider
  signer: JsonRpcSigner
  mutex = new Mutex()

  constructor (
    readonly entryPoint: EntryPoint,
    readonly bundlerHelper: BundlerHelper,
    readonly mempoolManager: MempoolManager,
    readonly validationManager: ValidationManager,
    readonly reputationManager: ReputationManager,
    readonly beneficiary: string,
    readonly minSignerBalance: BigNumberish,
    readonly maxBundleGas: number,
    readonly useConditionalRpc: boolean
  ) {
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

      const [bundle, storageMap] = await this.createBundle()
      if (bundle.length === 0) {
        debug('sendNextBundle - no bundle to send')
      } else {
        const beneficiary = await this._selectBeneficiary()
        const ret = await this.sendBundle(bundle, beneficiary, storageMap)
        debug(`sendNextBundle exit - after sent a bundle of ${bundle.length} `)
        return ret
      }
    })
  }

  /**
   * submit a bundle.
   * after submitting the bundle, remove all UserOps from the mempool
   * @return SendBundleReturn the transaction and UserOp hashes on successful transaction, or null on failed transaction
   */
  async sendBundle (userOps: UserOperation[], beneficiary: string, storageMap: StorageMap): Promise<SendBundleReturn | undefined> {
    try {
      const tx = await this.entryPoint.populateTransaction.handleOps(userOps, beneficiary)
      const signedTx = await this.signer.signTransaction(tx)
      let ret: TransactionResponse
      if (this.useConditionalRpc) {
        ret = await this.provider.send('eth_sendRawTransactionConditional', [
          signedTx, { knownAccounts: storageMap }
        ])
      } else {
        // ret = await this.signer.sendTransaction(tx)
        ret = await this.provider.send('eth_sendRawTransaction', [signedTx])
      }
      //TODO: parse ret, and revert if needed.
      console.log('ret=', ret)
      debug('sent handleOps with', userOps.length, 'ops. removing from mempool')
      this.mempoolManager.removeAllUserOps(userOps)
      // hashes are needed for debug rpc only.
      const hashes = await this.bundlerHelper.getUserOpHashes(this.entryPoint.address, userOps)
      return {
        transactionHash: ret.hash,
        userOpHashes: hashes
      }
    } catch (e: any) {
      // failed to handleOp. use FailedOp to detect by
      if (e.errorName !== 'FailedOp') {
        console.warn('Failed handleOps, but non-FailedOp error', e)
        return
      }
      const {
        index,
        paymaster,
        reason
      } = e.errorArgs
      const userOp = userOps[index]
      if (paymaster !== AddressZero) {
        this.reputationManager.crashedHandleOps(paymaster)
      } else if (typeof reason === 'string' && reason.startsWith('AA1')) {
        this.reputationManager.crashedHandleOps(getAddr(userOp.initCode))
      } else {
        this.mempoolManager.removeUserOp(userOp)
        console.warn(`Failed handleOps sender=${userOp.sender}`)
      }
    }
  }

  async createBundle (): Promise<[UserOperation[], StorageMap]> {
    const entries = this.mempoolManager.getSortedForInclusion()
    const bundle: UserOperation[] = []

    // paymaster deposit should be enough for all UserOps in the bundle.
    const paymasterDeposit: { [paymaster: string]: BigNumber } = {}
    // throttled paymasters and deployers are allowed only small UserOps per bundle.
    const stakedEntityCount: { [addr: string]: number } = {}
    // each sender is allowed only once per bundle
    const senders = new Set<string>()

    const storageMap: StorageMap = {}
    let totalGas = BigNumber.from(0)
    debug('got mempool of ', entries.length)
    for (const entry of entries) {
      const paymaster = getAddr(entry.userOp.paymasterAndData)
      const factory = getAddr(entry.userOp.initCode)
      const paymasterStatus = this.reputationManager.getStatus(paymaster)
      const deployerStatus = this.reputationManager.getStatus(factory)
      if (paymasterStatus === ReputationStatus.BANNED || deployerStatus === ReputationStatus.BANNED) {
        this.mempoolManager.removeUserOp(entry.userOp)
        continue
      }
      if (paymaster != null && (paymasterStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[paymaster] ?? 0) > 1)) {
        debug('skipping throttled paymaster', entry.userOp.sender, entry.userOp.nonce)
        continue
      }
      if (factory != null && (deployerStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[factory] ?? 0) > 1)) {
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
        validationResult = await this.validationManager.validateUserOp(entry.userOp, entry.referencedContracts, false)
      } catch (e: any) {
        debug('failed 2nd validation:', e.message)
        // failed validation. don't try anymore
        this.mempoolManager.removeUserOp(entry.userOp)
        continue
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
        if (paymasterDeposit[paymaster] == null) {
          paymasterDeposit[paymaster] = await this.entryPoint.balanceOf(paymaster)
        }
        if (paymasterDeposit[paymaster].lt(validationResult.returnInfo.prefund)) {
          // not enough balance in paymaster to pay for all UserOps
          // (but it passed validation, so it can sponsor them separately
          continue
        }
        stakedEntityCount[paymaster] = (stakedEntityCount[paymaster] ?? 0) + 1
        paymasterDeposit[paymaster] = paymasterDeposit[paymaster].sub(validationResult.returnInfo.prefund)
      }
      if (factory != null) {
        stakedEntityCount[factory] = (stakedEntityCount[factory] ?? 0) + 1
      }

      mergeStorageMap(storageMap, validationResult.storageMap)

      senders.add(entry.userOp.sender)
      bundle.push(entry.userOp)
      totalGas = newTotalGas
    }
    return [bundle, storageMap]
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
}
