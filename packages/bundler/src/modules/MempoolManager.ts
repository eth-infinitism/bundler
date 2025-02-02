import { BigNumber, BigNumberish } from 'ethers'
import Debug from 'debug'

import {
  OperationBase,
  RpcError,
  StakeInfo,
  ValidationErrors,
  getPackedNonce,
  requireCond
} from '@account-abstraction/utils'
import {
  AltMempoolConfig, ERC7562Rule,
  ValidateUserOpResult,
  ValidationResult
} from '@account-abstraction/validation-manager'

import { MempoolEntry } from './MempoolEntry'
import { ReputationManager } from './ReputationManager'
import { BaseAltMempoolRule } from '@account-abstraction/validation-manager/src/altmempool/AltMempoolConfig'
import { ERC7562Violation } from '@account-abstraction/validation-manager/dist/src/ERC7562Violation'

const debug = Debug('aa.mempool')

type MempoolDump = OperationBase[]

const THROTTLED_ENTITY_MEMPOOL_COUNT = 4

function isRuleViolated (
  userOp: OperationBase,
  violation: ERC7562Violation,
  config: { [rule in ERC7562Rule]?: BaseAltMempoolRule }
): boolean {
  const override = config[violation.rule]
  if (override == null) {
    return true
  }
  if (override.enabled === false) {
    return false
  }
  for (const exception of override.exceptions ?? []) {
    if (exception === violation.address) {
      return false
    }
    if (exception === 'sender' && violation.address === userOp.sender) {
      return false
    }
    // type RuleException = `0x${string}` | Role | AltMempoolRuleExceptionBase | AltMempoolRuleExceptionBannedOpcode
    // todo: match all possible exceptions
  }
  return true
}

export class MempoolManager {
  private mempool: MempoolEntry[] = []
  private altMempools: { [mempoolId: string]: MempoolEntry[] } = {}

  // count entities in mempool.
  private _entryCount: { [addr: string]: number | undefined } = {}

  constructor (
    private readonly reputationManager: ReputationManager,
    private altMempoolConfig: AltMempoolConfig) {
    this._initializeMempools()
  }

  private _initializeMempools (): void {
    for (const id of Object.keys(this.altMempoolConfig)) {
      this.altMempools[parseInt(id)] = []
    }
  }

  /**
   * Helper to allow for-of loop that of both the main and alt-mempools where possible without merging them in code.
   */
  private _getAllMempoolsLoop (): Array<[string, MempoolEntry[]]> {
    return Object.entries({ ...this.altMempools, 0: this.mempool })
  }

  /**
   * Helper function to allow skipping resource-intensive trace parsing if there are no configured alt-mempools.
   */
  hasAltMempools (): boolean {
    return Object.keys(this.altMempoolConfig).length === 0
  }

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

  count (): number {
    return this.mempool.length
  }

  // add userOp into the mempool, after initial validation.
  // replace existing, if any (and if new gas is higher)
  // reverts if unable to add UserOp to mempool (too many UserOps with this sender)
  addUserOp (
    skipValidation: boolean,
    userOp: OperationBase,
    userOpHash: string,
    validationResult: ValidateUserOpResult
  ): void {
    const entry = new MempoolEntry(
      userOp,
      userOpHash,
      validationResult,
      validationResult.returnInfo.prefund ?? 0,
      validationResult.referencedContracts,
      validationResult.ruleViolations,
      skipValidation,
      validationResult.aggregatorInfo?.addr
    )
    const packedNonce = getPackedNonce(entry.userOp)
    if (this._checkReplaceByFee(entry)) {
      debug('replace userOp', userOp.sender, packedNonce)
    } else {
      debug('add userOp', userOp.sender, packedNonce)
      if (!skipValidation) {
        this.checkReputation(validationResult)
        this.checkMultipleRolesViolation(userOp)
      }
      this.incrementEntryCount(userOp.sender)
      if (userOp.paymaster != null) {
        this.incrementEntryCount(userOp.paymaster)
      }
      if (userOp.factory != null) {
        this.incrementEntryCount(userOp.factory)
      }
      this.tryAssignToMempool(entry)
    }
    this.updateSeenStatus(validationResult.aggregatorInfo?.addr, userOp, validationResult.senderInfo)
  }

  private _checkReplaceByFee (entry: MempoolEntry): boolean {
    const packedNonce = getPackedNonce(entry.userOp)
    for (const [mempoolId, mempool] of this._getAllMempoolsLoop()) {
      const index = this._findBySenderNonce(entry.userOp.sender, packedNonce, mempool)
      let oldEntry: MempoolEntry | undefined
      if (index !== -1) {
        debug('replace userOp in alt-mempool', entry.userOp.sender, packedNonce, mempoolId)
        oldEntry = this.mempool[index]
        this.checkReplaceUserOp(oldEntry, entry)
        this.mempool[index] = entry
        this.updateSeenStatus(oldEntry.aggregator, oldEntry.userOp, entry.validateUserOpResult.senderInfo, -1)
      }
    }
    return false
  }

  private updateSeenStatus (aggregator: string | undefined, userOp: OperationBase, senderInfo: StakeInfo, val = 1): void {
    try {
      this.reputationManager.checkStake('account', senderInfo)
      this.reputationManager.updateSeenStatus(userOp.sender)
    } catch (e: any) {
      if (!(e instanceof RpcError)) throw e
    }
    this.reputationManager.updateSeenStatus(aggregator, val)
    this.reputationManager.updateSeenStatus(userOp.paymaster, val)
    this.reputationManager.updateSeenStatus(userOp.factory, val)
  }

  private checkReputation (
    validationResult: ValidationResult
  ): void {
    this.checkReputationStatus('account', validationResult.senderInfo)
    this.checkReputationStatus('paymaster', validationResult.paymasterInfo)
    this.checkReputationStatus('deployer', validationResult.factoryInfo)
    this.checkReputationStatus('aggregator', validationResult.aggregatorInfo)
  }

  private checkMultipleRolesViolation (userOp: OperationBase): void {
    const knownEntities = this.getKnownEntities()
    requireCond(
      !knownEntities.includes(userOp.sender.toLowerCase()),
      `The sender address "${userOp.sender}" is used as a different entity in another UserOperation currently in mempool`,
      ValidationErrors.OpcodeValidation
    )

    const knownSenders = this.getKnownSenders()
    const paymaster = userOp.paymaster
    const factory = userOp.factory

    const isPaymasterSenderViolation = knownSenders.includes(paymaster?.toLowerCase() ?? '')
    const isFactorySenderViolation = knownSenders.includes(factory?.toLowerCase() ?? '')

    requireCond(
      !isPaymasterSenderViolation,
      `A Paymaster at ${paymaster as string} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
      ValidationErrors.OpcodeValidation
    )
    requireCond(
      !isFactorySenderViolation,
      `A Factory at ${factory as string} in this UserOperation is used as a sender entity in another UserOperation currently in mempool.`,
      ValidationErrors.OpcodeValidation
    )
  }

  private checkReputationStatus (
    title: 'account' | 'paymaster' | 'aggregator' | 'deployer',
    stakeInfo?: StakeInfo
  ): void {
    if (stakeInfo == null) {
      // entity missing from this userop.
      return
    }
    const maxTxMempoolAllowedEntity = this.reputationManager.calculateMaxAllowedMempoolOpsUnstaked(title, stakeInfo.addr)
    // GREP-010 A `BANNED` address is not allowed into the mempool
    this.reputationManager.checkBanned(title, stakeInfo)
    const entryCount = this.entryCount(stakeInfo.addr) ?? 0
    if (entryCount > THROTTLED_ENTITY_MEMPOOL_COUNT) {
      this.reputationManager.checkThrottled(title, stakeInfo)
    }
    if (entryCount >= maxTxMempoolAllowedEntity) {
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

    function cost (op: OperationBase): number {
      // TODO: need to consult basefee and maxFeePerGas
      return BigNumber.from(op.maxPriorityFeePerGas).toNumber()
    }

    copy.sort((a, b) => cost(a.userOp) - cost(b.userOp))
    return copy
  }

  _findBySenderNonce (sender: string, nonce: BigNumberish, mempool: MempoolEntry[]): number {
    for (let i = 0; i < mempool.length; i++) {
      const curOp = mempool[i].userOp
      const packedNonce = getPackedNonce(curOp)
      if (curOp.sender === sender && packedNonce.eq(nonce)) {
        return i
      }
    }
    return -1
  }

  _findByHash (hash: string, mempool: MempoolEntry[]): number {
    for (let i = 0; i < mempool.length; i++) {
      const curOp = mempool[i]
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
  removeUserOp (userOpOrHash: OperationBase | string): void {
    for (const [mempoolId, mempool] of this._getAllMempoolsLoop()) {
      this._removeUserOpInternal(userOpOrHash, mempoolId, mempool)
    }
  }

  _removeUserOpInternal (userOpOrHash: OperationBase | string, mempoolId: string, mempool: MempoolEntry[]): void {
    let index: number
    if (typeof userOpOrHash === 'string') {
      index = this._findByHash(userOpOrHash, mempool)
    } else {
      const packedNonce = getPackedNonce(userOpOrHash)
      index = this._findBySenderNonce(userOpOrHash.sender, packedNonce, mempool)
    }
    if (index !== -1) {
      const userOp = mempool[index].userOp
      const packedNonce = getPackedNonce(userOp)
      debug('removeUserOp', userOp.sender, packedNonce)
      mempool.splice(index, 1)
      if (mempoolId !== '0') {
        // Only decrement entity counts for the main mempool
        // TODO: support per-mempool entity counts
        return
      }
      this.decrementEntryCount(userOp.sender)
      this.decrementEntryCount(userOp.paymaster)
      this.decrementEntryCount(userOp.factory)
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
      ...userOps.map(it => it.userOp.paymaster)
    )
    res.push(
      ...userOps.map(it => it.userOp.factory)
    )
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return res.filter(it => it != null).map(it => (it as string).toLowerCase())
  }

  getMempool (): MempoolEntry[] {
    return this.mempool
  }

  // GREP-010 A `BANNED` address is not allowed into the mempool
  removeBannedAddr (addr: string): void {
    // scan mempool in reverse. remove any UserOp where address is any entity
    for (let i = this.mempool.length - 1; i >= 0; i--) {
      const mempoolEntry = this.mempool[i]
      const userOp = mempoolEntry.userOp
      if (userOp.sender === addr || userOp.paymaster === addr || userOp.factory === addr) {
        this.removeUserOp(mempoolEntry.userOpHash)
      }
    }
  }

  private tryAssignToMempool (entry: MempoolEntry): number[] {
    if (entry.ruleViolations.length === 0) {
      this.mempool.push(entry)
      return [0]
    }
    const mempoolIds: number[] = []
    console.log(`UserOperation ${entry.userOpHash}`)
    for (const [mempoolId, config] of Object.entries(this.altMempoolConfig)) {
      console.log(` Mempool ID: ${mempoolId} Config: ${JSON.stringify(config)}`)
      for (const violation of entry.ruleViolations) {
        console.log(`  Violation: ${JSON.stringify(violation)}`)
        if (isRuleViolated(entry.userOp, violation, config)) {
          console.log(`   Not adding to mempool ${mempoolId} - rule violated`)
          continue
        }
        console.error(`   Adding to mempool ${mempoolId}`)
        this.altMempools[mempoolId].push(entry)
        this.reputationManager.updateSeenStatus(mempoolId)
      }
    }
    return mempoolIds
  }

  /**
   * Debug only function to clean up the existing alt-mempools and set a new alt-mempools configuration.
   */
  async _setAltMempoolConfig (altMempoolConfig: AltMempoolConfig): Promise<void> {
    this.altMempools = {}
    this.altMempoolConfig = altMempoolConfig
  }

  includedUserOp (userOpHash: string): void {
    for (const [mempoolId, mempool] of Object.entries(this.altMempools)) {
      const found = mempool.find((it: MempoolEntry) => {
        return it.userOpHash === userOpHash
      })
      if (found != null) {
        console.error(`Found UserOp ${userOpHash} in the mempool ${mempoolId}, updating INCLUDED`)
        this.reputationManager.updateIncludedStatus(mempoolId)
      }
    }
  }
}
