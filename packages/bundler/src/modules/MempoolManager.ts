import { BigNumber, BigNumberish } from 'ethers'
import {
  ReferencedCodeHashes,
  RpcError,
  StakeInfo,
  UserOperation,
  ValidationErrors,
  getAddr,
  requireCond
} from '@account-abstraction/utils'
import { ReputationManager } from './ReputationManager'
import Debug from 'debug'

const debug = Debug('aa.mempool')

export interface MempoolEntry {
  userOp: UserOperation
  userOpHash: string
  prefund: BigNumberish
  referencedContracts: ReferencedCodeHashes
  // aggregator, if one was found during simulation
  aggregator?: string
}

type MempoolDump = UserOperation[]

const MAX_MEMPOOL_USEROPS_PER_SENDER = 4
const THROTTLED_ENTITY_MEMPOOL_COUNT = 4

export class MempoolManager {
  private mempool: MempoolEntry[] = []

  // count entities in mempool.
  private _entryCount: { [addr: string]: number | undefined } = {}

  entryCount (address: string): number | undefined {
    return this._entryCount[address.toLowerCase()]
  }

  incrementEntryCount (address?: string): void {
    address = address?.toLowerCase()
    if (address == null) {
      return
    }
    this._entryCount[address] = (this._entryCount[address] ?? 0) + 1
  }

  decrementEntryCount (address?: string): void {
    address = address?.toLowerCase()
    if (address == null || this._entryCount[address] == null) {
      return
    }
    this._entryCount[address] = (this._entryCount[address] ?? 0) - 1
    if ((this._entryCount[address] ?? 0) <= 0) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this._entryCount[address]
    }
  }

  constructor (
    readonly reputationManager: ReputationManager) {
  }

  count (): number {
    return this.mempool.length
  }

  // add userOp into the mempool, after initial validation.
  // replace existing, if any (and if new gas is higher)
  // revets if unable to add UserOp to mempool (too many UserOps with this sender)
  addUserOp (
    userOp: UserOperation,
    userOpHash: string,
    prefund: BigNumberish,
    referencedContracts: ReferencedCodeHashes,
    senderInfo: StakeInfo,
    paymasterInfo?: StakeInfo,
    factoryInfo?: StakeInfo,
    aggregatorInfo?: StakeInfo
  ): void {
    const entry: MempoolEntry = {
      userOp,
      userOpHash,
      prefund,
      referencedContracts,
      aggregator: aggregatorInfo?.addr
    }
    const index = this._findBySenderNonce(userOp.sender, userOp.nonce)
    if (index !== -1) {
      const oldEntry = this.mempool[index]
      this.checkReplaceUserOp(oldEntry, entry)
      debug('replace userOp', userOp.sender, userOp.nonce)
      this.mempool[index] = entry
    } else {
      debug('add userOp', userOp.sender, userOp.nonce)
      this.incrementEntryCount(userOp.sender)
      const paymaster = getAddr(userOp.paymasterAndData)
      if (paymaster != null) {
        this.incrementEntryCount(paymaster)
      }
      const factory = getAddr(userOp.initCode)
      if (factory != null) {
        this.incrementEntryCount(factory)
      }
      this.checkReputation(senderInfo, paymasterInfo, factoryInfo, aggregatorInfo)
      this.checkMultipleRolesViolation(userOp)
      this.mempool.push(entry)
    }
    this.updateSeenStatus(aggregatorInfo?.addr, userOp, senderInfo)
  }

  private updateSeenStatus (aggregator: string | undefined, userOp: UserOperation, senderInfo: StakeInfo): void {
    try {
      this.reputationManager.checkStake('account', senderInfo)
      this.reputationManager.updateSeenStatus(userOp.sender)
    } catch (e: any) {
      if (!(e instanceof RpcError)) throw e
    }
    this.reputationManager.updateSeenStatus(aggregator)
    this.reputationManager.updateSeenStatus(getAddr(userOp.paymasterAndData))
    this.reputationManager.updateSeenStatus(getAddr(userOp.initCode))
  }

  // TODO: de-duplicate code
  // TODO 2: use configuration parameters instead of hard-coded constants
  private checkReputation (
    senderInfo: StakeInfo,
    paymasterInfo?: StakeInfo,
    factoryInfo?: StakeInfo,
    aggregatorInfo?: StakeInfo): void {
    this.checkReputationStatus('account', senderInfo, MAX_MEMPOOL_USEROPS_PER_SENDER)

    if (paymasterInfo != null) {
      this.checkReputationStatus('paymaster', paymasterInfo)
    }

    if (factoryInfo != null) {
      this.checkReputationStatus('deployer', factoryInfo)
    }

    if (aggregatorInfo != null) {
      this.checkReputationStatus('aggregator', aggregatorInfo)
    }
  }

  private checkMultipleRolesViolation (userOp: UserOperation): void {
    const knownEntities = this.getKnownEntities()
    requireCond(
      !knownEntities.includes(userOp.sender.toLowerCase()),
      `The sender address "${userOp.sender}" is used as a different entity in another UserOperation currently in mempool`,
      ValidationErrors.OpcodeValidation
    )

    const knownSenders = this.getKnownSenders()
    const paymaster = getAddr(userOp.paymasterAndData)?.toLowerCase()
    const factory = getAddr(userOp.initCode)?.toLowerCase()

    const isPaymasterSenderViolation = knownSenders.includes(paymaster?.toLowerCase() ?? '')
    const isFactorySenderViolation = knownSenders.includes(factory?.toLowerCase() ?? '')

    requireCond(
      !isPaymasterSenderViolation,
      `A Paymaster at ${paymaster} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
      ValidationErrors.OpcodeValidation
    )
    requireCond(
      !isFactorySenderViolation,
      `A Factory at ${factory} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
      ValidationErrors.OpcodeValidation
    )
  }

  private checkReputationStatus (
    title: 'account' | 'paymaster' | 'aggregator' | 'deployer',
    stakeInfo: StakeInfo,
    maxTxMempoolAllowedOverride?: number
  ): void {
    const maxTxMempoolAllowedEntity = maxTxMempoolAllowedOverride ??
      this.reputationManager.calculateMaxAllowedMempoolOpsUnstaked(stakeInfo.addr)
    this.reputationManager.checkBanned(title, stakeInfo)
    const entryCount = this.entryCount(stakeInfo.addr) ?? 0
    if (entryCount > THROTTLED_ENTITY_MEMPOOL_COUNT) {
      this.reputationManager.checkThrottled(title, stakeInfo)
    }
    if (entryCount > maxTxMempoolAllowedEntity) {
      this.reputationManager.checkStake(title, stakeInfo)
    }
  }

  private checkReplaceUserOp (oldEntry: MempoolEntry, entry: MempoolEntry): void {
    const oldMaxPriorityFeePerGas = BigNumber.from(oldEntry.userOp.maxPriorityFeePerGas).toNumber()
    const newMaxPriorityFeePerGas = BigNumber.from(entry.userOp.maxPriorityFeePerGas).toNumber()
    const oldMaxFeePerGas = BigNumber.from(oldEntry.userOp.maxFeePerGas).toNumber()
    const newMaxFeePerGas = BigNumber.from(entry.userOp.maxFeePerGas).toNumber()
    // the error is "invalid fields", even though it is detected only after validation
    requireCond(newMaxPriorityFeePerGas >= oldMaxPriorityFeePerGas * 1.1,
      `Replacement UserOperation must have higher maxPriorityFeePerGas (old=${oldMaxPriorityFeePerGas} new=${newMaxPriorityFeePerGas}) `, ValidationErrors.InvalidFields)
    requireCond(newMaxFeePerGas >= oldMaxFeePerGas * 1.1,
      `Replacement UserOperation must have higher maxFeePerGas (old=${oldMaxFeePerGas} new=${newMaxFeePerGas}) `, ValidationErrors.InvalidFields)
  }

  getSortedForInclusion (): MempoolEntry[] {
    const copy = Array.from(this.mempool)

    function cost (op: UserOperation): number {
      // TODO: need to consult basefee and maxFeePerGas
      return BigNumber.from(op.maxPriorityFeePerGas).toNumber()
    }

    copy.sort((a, b) => cost(a.userOp) - cost(b.userOp))
    return copy
  }

  _findBySenderNonce (sender: string, nonce: BigNumberish): number {
    for (let i = 0; i < this.mempool.length; i++) {
      const curOp = this.mempool[i].userOp
      if (curOp.sender === sender && curOp.nonce === nonce) {
        return i
      }
    }
    return -1
  }

  _findByHash (hash: string): number {
    for (let i = 0; i < this.mempool.length; i++) {
      const curOp = this.mempool[i]
      if (curOp.userOpHash === hash) {
        return i
      }
    }
    return -1
  }

  /**
   * remove UserOp from mempool. either it is invalid, or was included in a block
   * @param userOpOrHash
   */
  removeUserOp (userOpOrHash: UserOperation | string): void {
    let index: number
    if (typeof userOpOrHash === 'string') {
      index = this._findByHash(userOpOrHash)
    } else {
      index = this._findBySenderNonce(userOpOrHash.sender, userOpOrHash.nonce)
    }
    if (index !== -1) {
      const userOp = this.mempool[index].userOp
      debug('removeUserOp', userOp.sender, userOp.nonce)
      this.mempool.splice(index, 1)
      this.decrementEntryCount(userOp.sender)
      this.decrementEntryCount(getAddr(userOp.paymasterAndData))
      this.decrementEntryCount(getAddr(userOp.initCode))
      // TODO: store and remove aggregator entity count
    }
  }

  /**
   * debug: dump mempool content
   */
  dump (): MempoolDump {
    return this.mempool.map(entry => entry.userOp)
  }

  /**
   * for debugging: clear current in-memory state
   */
  clearState (): void {
    this.mempool = []
    this._entryCount = {}
  }

  /**
   * Returns all addresses that are currently known to be "senders" according to the current mempool.
   */
  getKnownSenders (): string[] {
    return this.mempool.map(it => {
      return it.userOp.sender.toLowerCase()
    })
  }

  /**
   * Returns all addresses that are currently known to be any kind of entity according to the current mempool.
   * Note that "sender" addresses are not returned by this function. Use {@link getKnownSenders} instead.
   */
  getKnownEntities (): string[] {
    const res = []
    const userOps = this.mempool
    res.push(
      ...userOps.map(it => {
        return getAddr(it.userOp.paymasterAndData)
      })
    )
    res.push(
      ...userOps.map(it => {
        return getAddr(it.userOp.initCode)
      })
    )
    return res.filter(it => it != null).map(it => (it as string).toLowerCase())
  }
}
