import Debug from 'debug'
import { BigNumber, BigNumberish, PopulatedTransaction, Signer } from 'ethers'
import { ErrorDescription } from '@ethersproject/abi/lib/interface'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Mutex } from 'async-mutex'
import { hexlify, isAddress } from 'ethers/lib/utils'

import {
  EmptyValidateUserOpResult,
  IValidationManager,
  ValidateUserOpResult
} from '@account-abstraction/validation-manager'

import {
  AddressZero,
  EIP7702Authorization,
  IEntryPoint,
  OperationBase,
  RpcError,
  StorageMap,
  UserOperation,
  ValidationErrors,
  getEip7702AuthorizationSigner,
  mergeStorageMap,
  packUserOp,
  getUserOpHash, getAuthorizationList
} from '@account-abstraction/utils'

import { EventsManager } from './EventsManager'
import { IBundleManager } from './IBundleManager'
import { MempoolEntry } from './MempoolEntry'
import { MempoolManager } from './MempoolManager'
import { ReputationManager, ReputationStatus } from './ReputationManager'
import { ChainConfig, Common, Hardfork, Mainnet } from '@ethereumjs/common'
import { EOACode7702Transaction } from '@ethereumjs/tx'
import { AuthorizationList, EOACode7702TxData } from '@ethereumjs/tx/src/types'
import { PrefixedHexString } from '@ethereumjs/util'
import { toRlpHex } from '@account-abstraction/utils/dist/src/interfaces/EIP7702Authorization'

const debug = Debug('aa.exec.cron')

const THROTTLED_ENTITY_BUNDLE_COUNT = 4

const TX_TYPE_EIP_7702 = 4
const TX_TYPE_EIP_1559 = 2

export interface SendBundleReturn {
  transactionHash: string
  userOpHashes: string[]
}

export class BundleManager implements IBundleManager {
  readonly entryPoint: IEntryPoint
  mutex = new Mutex()

  constructor (
    _entryPoint: IEntryPoint | undefined,
    readonly provider: JsonRpcProvider,
    readonly signer: Signer,
    readonly eventsManager: EventsManager,
    readonly mempoolManager: MempoolManager,
    readonly validationManager: IValidationManager,
    readonly reputationManager: ReputationManager,
    readonly beneficiary: string,
    readonly minSignerBalance: BigNumberish,
    readonly maxBundleGas: number,
    // use eth_sendRawTransactionConditional with storage map
    readonly conditionalRpc: boolean,
    // in conditionalRpc: always put root hash (not specific storage slots) for "sender" entries
    readonly mergeToAccountRootHash: boolean = false
  ) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.entryPoint = _entryPoint!
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

      // TODO: pass correct bundle limit parameters!
      const [bundle, eip7702Tuples, storageMap] = await this.createBundle(0, 0, 0)
      if (bundle.length === 0) {
        debug('sendNextBundle - no bundle to send')
      } else {
        const beneficiary = await this._selectBeneficiary()
        const ret = await this.sendBundle(bundle as UserOperation[], eip7702Tuples, beneficiary, storageMap)
        debug(`sendNextBundle exit - after sent a bundle of ${bundle.length} `)
        return ret
      }
    })
  }

  async handlePastEvents (): Promise<void> {
    await this.eventsManager.handlePastEvents()
  }

  // parse revert from FailedOp(index,str) or FailedOpWithRevert(uint256 opIndex, string reason, bytes inner);
  // return undefined values on failure.
  parseFailedOpRevert (e: any): { opIndex?: number, reasonStr?: string } {
    if (e.message != null) {
      const match = e.message.match(/FailedOp\w*\((\d+),"(.*?)"/)
      if (match != null) {
        return {
          opIndex: parseInt(match[1]),
          reasonStr: match[2]
        }
      }
    }
    let parsedError: ErrorDescription
    try {
      let data = e.data?.data ?? e.data
      // geth error body, packed in ethers exception object
      const body = e?.error?.error?.body
      if (body != null) {
        const jsonBody = JSON.parse(body)
        data = jsonBody.error.data?.data ?? jsonBody.error.data
      }

      parsedError = this.entryPoint.interface.parseError(data)
    } catch (e1) {
      return { opIndex: undefined, reasonStr: undefined }
    }
    const {
      opIndex,
      reason
    } = parsedError.args
    return {
      opIndex,
      reasonStr: reason.toString()
    }
  }

  /**
   * submit a bundle.
   * after submitting the bundle, remove all UserOps from the mempool
   * @return SendBundleReturn the transaction and UserOp hashes on successful transaction, or null on failed transaction
   */
  async sendBundle (userOps: UserOperation[], eip7702Tuples: EIP7702Authorization[], beneficiary: string, storageMap: StorageMap): Promise<SendBundleReturn | undefined> {
    try {
      const feeData = await this.provider.getFeeData()
      // TODO: estimate is not enough. should trace with validation rules, to prevent on-chain revert.
      const type = eip7702Tuples.length > 0 ? TX_TYPE_EIP_7702 : TX_TYPE_EIP_1559
      const tx = await this.entryPoint.populateTransaction.handleOps(userOps.map(packUserOp), beneficiary, {
        type,
        nonce: await this.signer.getTransactionCount(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
        maxFeePerGas: feeData.maxFeePerGas ?? 0
      })
      tx.chainId = this.provider._network.chainId
      let ret: string
      if (this.conditionalRpc) {
        const signedTx = await this.signer.signTransaction(tx)
        debug('eth_sendRawTransactionConditional', storageMap)
        ret = await this.provider.send('eth_sendRawTransactionConditional', [
          signedTx, { knownAccounts: storageMap }
        ])
        debug('eth_sendRawTransactionConditional ret=', ret)
      } else if (tx.type === TX_TYPE_EIP_7702) {
        const ethereumJsTx = await this._prepareEip7702Transaction(tx, eip7702Tuples)
        const res = await this.provider.send('eth_sendRawTransaction', [ethereumJsTx])
        const rcpt = await this.provider.getTransactionReceipt(res)
        ret = rcpt.transactionHash
      } else {
        const resp = await this.signer.sendTransaction(tx)
        const rcpt = await resp.wait()
        ret = rcpt.transactionHash
        // ret = await this.provider.send('eth_sendRawTransaction', [signedTx])
        debug('eth_sendTransaction ret=', ret)
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
      const {
        opIndex,
        reasonStr
      } = this.parseFailedOpRevert(e)
      if (opIndex == null || reasonStr == null) {
        this.checkFatal(e)
        console.warn('Failed handleOps, but non-FailedOp error', e)
        return
      }
      const userOp = userOps[opIndex]

      const addr = await this._findEntityToBlame(reasonStr, userOp)
      if (addr != null) {
        this.reputationManager.updateSeenStatus(userOp.sender, -1)
        this.reputationManager.updateSeenStatus(userOp.paymaster, -1)
        this.reputationManager.updateSeenStatus(userOp.factory, -1)
        this.mempoolManager.removeBannedAddr(addr)
        this.reputationManager.crashedHandleOps(addr)
      } else {
        console.error(`Failed handleOps, but no entity to blame. reason=${reasonStr}`)
      }
      this.mempoolManager.removeUserOp(userOp)
      console.warn(`Failed handleOps sender=${userOp.sender} reason=${reasonStr}`)
    }
  }

  // TODO: this is a temporary patch until ethers.js adds EIP-7702 support
  async _prepareEip7702Transaction (tx: PopulatedTransaction, eip7702Tuples: EIP7702Authorization[]): Promise<string> {
    debug('creating EIP-7702 transaction')
    // TODO: read fields from the configuration
    // @ts-ignore
    const chain: ChainConfig = {
      bootstrapNodes: [],
      defaultHardfork: Hardfork.Prague,
      // consensus: undefined,
      // genesis: undefined,
      hardforks: Mainnet.hardforks,
      name: '',
      chainId: 1337
    }
    const common = new Common({ chain, eips: [2718, 2929, 2930, 7702] })

    const authorizationList: AuthorizationList = eip7702Tuples.map(it => {
      return {
        chainId: toRlpHex(it.chainId),
        address: toRlpHex(it.address),
        nonce: toRlpHex(it.nonce),
        yParity: toRlpHex(it.yParity),
        r: toRlpHex(it.r),
        s: toRlpHex(it.s)
      }
    })
    const txData: EOACode7702TxData = {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      nonce: hexlify(tx.nonce!) as PrefixedHexString,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: hexlify(tx.to!) as PrefixedHexString,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      value: '0x0',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data: hexlify(tx.data!) as PrefixedHexString,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      chainId: hexlify(tx.chainId!) as PrefixedHexString,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      maxPriorityFeePerGas: hexlify(tx.maxPriorityFeePerGas!) as PrefixedHexString,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      maxFeePerGas: hexlify(tx.maxPriorityFeePerGas!) as PrefixedHexString,
      accessList: [],
      authorizationList
    }
    // TODO: not clear why but 'eth_estimateGas' gives an 'execution reverted' error
    // txData.gasLimit = await this.provider.send('eth_estimateGas', [txData])
    txData.gasLimit = 10_000_000
    const objectTx = new EOACode7702Transaction(txData, { common })
    const privateKey = Buffer.from(
      // @ts-ignore
      this.signer.privateKey.slice(2),
      'hex'
    )

    const signedTx = objectTx.sign(privateKey)
    const encodedTx = signedTx.serialize()
    return hexlify(encodedTx)
  }

  async _findEntityToBlame (reasonStr: string, userOp: UserOperation): Promise<string | undefined> {
    if (reasonStr.startsWith('AA3')) {
      // [EREP-030] A staked account is accountable for failure in any entity
      console.log(`${reasonStr}: staked account ${await this.isAccountStaked(userOp)} ? sender ${userOp.sender} : pm ${userOp.paymaster}`)
      return await this.isAccountStaked(userOp) ? userOp.sender : userOp.paymaster
    } else if (reasonStr.startsWith('AA2')) {
      // [EREP-020] A staked factory is "accountable" for account
      // [EREP-015]: paymaster is not blamed for account/factory failure
      console.log(`${reasonStr}: staked factory ${await this.isFactoryStaked(userOp)} ? factory ${userOp.factory} : sender ${userOp.sender}`)
      return await this.isFactoryStaked(userOp) ? userOp.factory : userOp.sender
    } else if (reasonStr.startsWith('AA1')) {
      // [EREP-015]: paymaster is not blamed for account/factory failure
      // (can't have staked account during its creation)
      return userOp.factory
    }
    return undefined
  }

  async isAccountStaked (userOp: UserOperation): Promise<boolean> {
    const senderStakeInfo = await this.reputationManager.getStakeStatus(userOp.sender, this.entryPoint.address)
    return senderStakeInfo?.isStaked
  }

  async isFactoryStaked (userOp: UserOperation): Promise<boolean> {
    const factoryStakeInfo = userOp.factory == null
      ? null
      : await this.reputationManager.getStakeStatus(userOp.factory, this.entryPoint.address)
    return factoryStakeInfo?.isStaked ?? false
  }

  // fatal errors we know we can't recover
  checkFatal (e: any): void {
    // console.log('ex entries=',Object.entries(e))
    if (e.error?.code === -32601) {
      throw e
    }
  }

  async createBundle (
    minBaseFee?: BigNumberish,
    maxBundleGas?: BigNumberish,
    maxBundleSize?: BigNumberish
  ): Promise<[OperationBase[], EIP7702Authorization[], StorageMap]> {
    const entries = this.mempoolManager.getSortedForInclusion()
    const bundle: OperationBase[] = []
    const sharedAuthorizationList: EIP7702Authorization[] = []

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
    let bundleGas = BigNumber.from(0)
    // eslint-disable-next-line no-labels
    mainLoop:
    for (const entry of entries) {
      const maxBundleSizeNum = BigNumber.from(maxBundleSize ?? 0).toNumber()
      if (maxBundleSizeNum !== 0 && entries.length >= maxBundleSizeNum) {
        debug('exiting after maxBundleSize is reached', maxBundleSize, entries.length)
        break
      }
      if (
        minBaseFee != null &&
        !BigNumber.from(minBaseFee).eq(0) &&
        BigNumber.from(entry.userOp.maxFeePerGas).lt(minBaseFee)
      ) {
        debug('skipping transaction not paying minBaseFee', minBaseFee, entry.userOp.maxFeePerGas)
        continue
      }
      const paymaster = entry.userOp.paymaster
      const factory = entry.userOp.factory
      const paymasterStatus = this.reputationManager.getStatus(paymaster)
      const deployerStatus = this.reputationManager.getStatus(factory)
      if (paymasterStatus === ReputationStatus.BANNED || deployerStatus === ReputationStatus.BANNED) {
        this.mempoolManager.removeUserOp(entry.userOp)
        continue
      }
      // [GREP-020] - renamed from [SREP-030]
      // @ts-ignore
      if (paymaster != null && (paymasterStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[paymaster] ?? 0) > THROTTLED_ENTITY_BUNDLE_COUNT)) {
        debug('skipping throttled paymaster', entry.userOp.sender, (entry.userOp as any).nonce)
        continue
      }
      // [GREP-020] - renamed from [SREP-030]
      // @ts-ignore
      if (factory != null && (deployerStatus === ReputationStatus.THROTTLED ?? (stakedEntityCount[factory] ?? 0) > THROTTLED_ENTITY_BUNDLE_COUNT)) {
        debug('skipping throttled factory', entry.userOp.sender, (entry.userOp as any).nonce)
        continue
      }
      if (senders.has(entry.userOp.sender)) {
        debug('skipping already included sender', entry.userOp.sender, (entry.userOp as any).nonce)
        // allow only a single UserOp per sender per bundle
        continue
      }
      let validationResult: ValidateUserOpResult = EmptyValidateUserOpResult
      try {
        if (!entry.skipValidation) {
          // re-validate UserOp. no need to check stake, since it cannot be reduced between first and 2nd validation
          validationResult = await this.validationManager.validateUserOp(entry.userOp, entry.referencedContracts, false)
        } else {
          console.warn('Skipping second validation for an injected debug operation, id=', entry.userOpHash)
        }
      } catch (e: any) {
        await this._handleSecondValidationException(e, paymaster, entry)
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
      // TODO: reduce duplication here - some difference in logic but close enough
      if (newTotalGas.gt(this.maxBundleGas)) {
        debug('exiting after config maxBundleGas is reached', this.maxBundleGas, bundleGas, entry.userOpMaxGas)
        break
      }
      if (
        maxBundleGas != null &&
        !BigNumber.from(maxBundleGas).eq(0) &&
        newTotalGas.gte(maxBundleGas)) {
        debug('exiting after request maxBundleGas is reached', maxBundleGas, bundleGas, entry.userOpMaxGas)
        break
      }

      if (paymaster != null && isAddress(paymaster) && paymaster.toLowerCase() !== AddressZero) {
        if (paymasterDeposit[paymaster] == null) {
          paymasterDeposit[paymaster] = await this.getPaymasterBalance(paymaster)
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (paymasterDeposit[paymaster].lt(validationResult.returnInfo.prefund!)) {
          // not enough balance in paymaster to pay for all UserOps
          // (but it passed validation, so it can sponsor them separately
          continue
        }
        stakedEntityCount[paymaster] = (stakedEntityCount[paymaster] ?? 0) + 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        paymasterDeposit[paymaster] = paymasterDeposit[paymaster].sub(validationResult.returnInfo.prefund!)
      }
      if (factory != null && isAddress(factory)) {
        stakedEntityCount[factory] = (stakedEntityCount[factory] ?? 0) + 1
      }

      // If sender's account already exist: replace with its storage root hash
      if (this.mergeToAccountRootHash && this.conditionalRpc && entry.userOp.factory == null) {
        const { storageHash } = await this.provider.send('eth_getProof', [entry.userOp.sender, [], 'latest'])
        storageMap[entry.userOp.sender.toLowerCase()] = storageHash
      }
      mergeStorageMap(storageMap, validationResult.storageMap)

      const mergeOk = this.mergeEip7702Authorizations(entry, sharedAuthorizationList)
      if (!mergeOk) {
        debug('unable to add bundle as it relies on an EIP-7702 tuple that conflicts with other UserOperations')
        continue
      }

      bundleGas = bundleGas.add(entry.userOpMaxGas)
      senders.add(entry.userOp.sender)
      bundle.push(entry.userOp)
      totalGas = newTotalGas
    }
    return [bundle, sharedAuthorizationList, storageMap]
  }

  /**
   * Merges the EIP-7702 authorizations from the given mempool entry into the provided authorization list.
   *
   * @param {MempoolEntry} entry - The mempool entry containing a list of UserOperation authorizations to be checked.
   * @param {EIP7702Authorization[]} authList - The list of existing EIP-7702 authorizations to update.
   * @return {boolean} - Returns `true` if the authorizations were successfully merged, otherwise `false`.
   */
  mergeEip7702Authorizations (entry: MempoolEntry, authList: EIP7702Authorization[]): boolean {
    const authorizationList = getAuthorizationList(entry.userOp)
    for (const eip7702Authorization of authorizationList) {
      const existingAuthorization = authList
        .find(it => getEip7702AuthorizationSigner(it) === getEip7702AuthorizationSigner(eip7702Authorization))
      if (existingAuthorization == null) {
        authList.push(eip7702Authorization)
      } else if (existingAuthorization.address.toLowerCase() !== eip7702Authorization.address.toLowerCase()) {
        return false
      }
    }
    return true
  }

  async _handleSecondValidationException (e: any, paymaster: string | undefined, entry: MempoolEntry): Promise<void> {
    debug('failed 2nd validation:', e.message)

    const {
      opIndex,
      reasonStr
    } = this.parseFailedOpRevert(e)
    if (opIndex == null || reasonStr == null) {
      this.checkFatal(e)
      console.warn('Failed validation, but non-FailedOp error', e)
      this.mempoolManager.removeUserOp(entry.userOp)
      return
    }

    const addr = await this._findEntityToBlame(reasonStr, entry.userOp as UserOperation)
    if (addr !== null) {
      // undo all "updateSeen" of all entities, and only blame "addr":
      this.reputationManager.updateSeenStatus(entry.userOp.sender, -1)
      this.reputationManager.updateSeenStatus(entry.userOp.paymaster, -1)
      this.reputationManager.updateSeenStatus(entry.userOp.factory, -1)
      this.reputationManager.updateSeenStatus(addr, 1)
    }

    // failed validation. don't try anymore this userop
    this.mempoolManager.removeUserOp(entry.userOp)
  }

  _isAccountOrFactoryError (e: any): boolean {
    return e instanceof RpcError && e.code === ValidationErrors.SimulateValidation &&
      (e?.message.match(/FailedOpWithRevert\(\d+,"AA[21]/)) != null
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
    const network = await this.entryPoint.provider.getNetwork()
    return userOps.map(it => getUserOpHash(it, this.entryPoint.address, network.chainId))
  }

  async getPaymasterBalance (paymaster: string): Promise<BigNumber> {
    return await this.entryPoint.balanceOf(paymaster)
  }
}
