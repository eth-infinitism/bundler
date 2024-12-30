import Debug from 'debug'
import { BigNumber } from 'ethers'
import { Provider } from '@ethersproject/providers'

import { StakeInfo, ValidationErrors, requireCond, tostr } from '@account-abstraction/utils'
import { IStakeManager__factory } from '../types'

const debug = Debug('aa.rep')

/**
 * throttled entities are allowed minimal number of entries per bundle. banned entities are allowed none
 */

const BAN_OPS_SEEN_PENALTY = 10000
const SAME_SENDER_MEMPOOL_COUNT = 4
const SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT = 10

export enum ReputationStatus {
  OK, THROTTLED, BANNED
}

export interface ReputationParams {
  minInclusionDenominator: number
  throttlingSlack: number
  banSlack: number
}

export const BundlerReputationParams: ReputationParams = {
  minInclusionDenominator: 10,
  throttlingSlack: 10,
  banSlack: 50
}

export const NonBundlerReputationParams: ReputationParams = {
  minInclusionDenominator: 100,
  throttlingSlack: 10,
  banSlack: 10
}

interface ReputationEntry {
  address: string
  opsSeen: number
  opsIncluded: number
  status?: ReputationStatus
}

export type ReputationDump = ReputationEntry[]

export class ReputationManager {
  constructor (
    readonly provider: Provider,
    readonly params: ReputationParams,
    readonly minStake: BigNumber,
    readonly minUnstakeDelay: number) {
  }

  private entries: { [address: string]: ReputationEntry } = {}
  // black-listed entities - always banned
  readonly blackList = new Set<string>()

  // white-listed entities - always OK.
  readonly whitelist = new Set<string>()

  /**
   * debug: dump reputation map (with updated "status" for each entry)
   */
  dump (): ReputationDump {
    Object.values(this.entries).forEach(entry => { entry.status = this.getStatus(entry.address) })
    return Object.values(this.entries)
  }

  /**
   * exponential backoff of opsSeen and opsIncluded values
   */
  hourlyCron (): void {
    Object.keys(this.entries).forEach(addr => {
      const entry = this.entries[addr]
      entry.opsSeen = Math.floor(entry.opsSeen * 23 / 24)
      entry.opsIncluded = Math.floor(entry.opsSeen * 23 / 24)
      if (entry.opsIncluded === 0 && entry.opsSeen === 0) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete this.entries[addr]
      }
    })
  }

  addWhitelist (...params: string[]): void {
    params.forEach(item => this.whitelist.add(item))
  }

  addBlacklist (...params: string[]): void {
    params.forEach(item => this.blackList.add(item))
  }

  _getOrCreate (addr: string): ReputationEntry {
    addr = addr.toLowerCase()
    let entry = this.entries[addr]
    if (entry == null) {
      this.entries[addr] = entry = {
        address: addr,
        opsSeen: 0,
        opsIncluded: 0
      }
    }
    return entry
  }

  /**
   * address seen in the mempool triggered by the
   * @param addr
   * @param val increment value for "seen" status
   */
  updateSeenStatus (addr?: string, val = 1): void {
    if (addr == null) {
      return
    }
    const entry = this._getOrCreate(addr)
    entry.opsSeen = Math.max(0, entry.opsSeen + val)
    debug('after seen+', val, addr, entry)
  }

  /**
   * found paymaster/deployer/agregator on-chain.
   * triggered by the EventsManager.
   * @param addr
   */
  updateIncludedStatus (addr: string): void {
    const entry = this._getOrCreate(addr)
    entry.opsIncluded++
    debug('after Included++', addr, entry)
  }

  isWhitelisted (addr: string): boolean {
    return this.whitelist.has(addr)
  }

  // https://github.com/eth-infinitism/account-abstraction/blob/develop/eip/EIPS/eip-4337.md#reputation-scoring-and-throttlingbanning-for-paymasters
  getStatus (addr?: string): ReputationStatus {
    addr = addr?.toLowerCase()
    if (addr == null || this.whitelist.has(addr)) {
      return ReputationStatus.OK
    }
    if (this.blackList.has(addr)) {
      return ReputationStatus.BANNED
    }
    const entry = this.entries[addr]
    if (entry == null) {
      return ReputationStatus.OK
    }
    const minExpectedIncluded = Math.floor(entry.opsSeen / this.params.minInclusionDenominator)
    if (minExpectedIncluded <= entry.opsIncluded + this.params.throttlingSlack) {
      return ReputationStatus.OK
    } else if (minExpectedIncluded <= entry.opsIncluded + this.params.banSlack) {
      return ReputationStatus.THROTTLED
    } else {
      return ReputationStatus.BANNED
    }
  }

  async getStakeStatus (address: string, entryPointAddress: string): Promise<{
    stakeInfo: StakeInfo
    isStaked: boolean
  }> {
    const sm = IStakeManager__factory.connect(entryPointAddress, this.provider)
    const info = await sm.getDepositInfo(address)
    const isStaked =
      BigNumber.from(info.stake).gte(this.minStake) &&
      BigNumber.from(info.unstakeDelaySec).gte(this.minUnstakeDelay)
    return {
      stakeInfo: {
        addr: address,
        stake: info.stake.toString(),
        unstakeDelaySec: info.unstakeDelaySec.toString()
      },
      isStaked
    }
  }

  /**
   * an entity that caused handleOps to revert, which requires re-building the bundle from scratch.
   * should be banned immediately, by increasing its opSeen counter
   * @param addr
   */
  crashedHandleOps (addr: string | undefined): void {
    if (addr == null) {
      return
    }
    // todo: what value to put? how long do we want this banning to hold?
    const entry = this._getOrCreate(addr)
    // GREP-040 (was SREP-050) ban entity that failed bundle creation.
    entry.opsSeen += BAN_OPS_SEEN_PENALTY
    entry.opsIncluded = 0
    debug('crashedHandleOps', addr, entry)
  }

  /**
   * for debugging: clear in-memory state
   */
  clearState (): void {
    this.entries = {}
  }

  /**
   * for debugging: put in the given reputation entries
   * @param entries
   */
  setReputation (reputations: ReputationDump): ReputationDump {
    reputations.forEach(rep => {
      this.entries[rep.address.toLowerCase()] = {
        address: rep.address.toLowerCase(),
        opsSeen: BigNumber.from(rep.opsSeen).toNumber(),
        opsIncluded: BigNumber.from(rep.opsIncluded).toNumber()
      }
    })
    return this.dump()
  }

  /**
   * check the given address (account/paymaster/deployer/aggregator) is banned
   * unlike {@link checkStake} does not check whitelist or stake
   */
  checkBanned (title: 'account' | 'paymaster' | 'aggregator' | 'deployer', info: StakeInfo): void {
    requireCond(this.getStatus(info.addr) !== ReputationStatus.BANNED,
      `${title} ${info.addr} is banned`,
      ValidationErrors.Reputation, { [title]: info.addr })
  }

  /**
   * check the given address (account/paymaster/deployer/aggregator) is throttled
   * unlike {@link checkStake} does not check whitelist or stake
   */
  checkThrottled (title: 'account' | 'paymaster' | 'aggregator' | 'deployer', info: StakeInfo): void {
    requireCond(this.getStatus(info.addr) !== ReputationStatus.THROTTLED,
      `${title} ${info.addr} is throttled`,
      ValidationErrors.Reputation, { [title]: info.addr })
  }

  /**
   * check the given address (account/paymaster/deployer/aggregator) is staked
   * @param title the address title (field name to put into the "data" element)
   * @param raddr the address to check the stake of. null is "ok"
   * @param info stake info from verification. if not given, then read from entryPoint
   */
  checkStake (title: 'account' | 'paymaster' | 'aggregator' | 'deployer', info?: StakeInfo): void {
    if (info?.addr == null || this.isWhitelisted(info.addr)) {
      return
    }
    requireCond(this.getStatus(info.addr) !== ReputationStatus.BANNED,
      `${title} ${info.addr} is banned`,
      ValidationErrors.Reputation, { [title]: info.addr })

    requireCond(BigNumber.from(info.stake).gte(this.minStake),
      `${title} ${info.addr} ${tostr(info.stake) === '0' ? 'is unstaked' : `stake ${tostr(info.stake)} is too low (min=${tostr(this.minStake)})`}`,
      ValidationErrors.InsufficientStake)
    requireCond(BigNumber.from(info.unstakeDelaySec).gte(this.minUnstakeDelay),
      `${title} ${info.addr} unstake delay ${tostr(info.unstakeDelaySec)} is too low (min=${tostr(this.minUnstakeDelay)})`,
      ValidationErrors.InsufficientStake)
  }

  /**
   * @param title - the entity type
   * @param entity - the address of a non-sender unstaked entity.
   * @returns maxMempoolCount - the number of UserOperations this entity is allowed to have in the mempool.
   */
  calculateMaxAllowedMempoolOpsUnstaked (
    title: 'account' | 'paymaster' | 'aggregator' | 'deployer',
    entity: string
  ): number {
    entity = entity.toLowerCase()
    if (title === 'account') {
      // UREP-010: An unstaked sender is only allowed to have SAME_SENDER_MEMPOOL_COUNT
      return SAME_SENDER_MEMPOOL_COUNT
    }

    // [UREP-020] unstaked entity reputation
    const entry = this.entries[entity]
    if (entry == null) {
      return SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT
    }
    const INCLUSION_RATE_FACTOR = 10
    let inclusionRate = entry.opsIncluded / entry.opsSeen
    if (entry.opsSeen === 0) {
      // prevent NaN of Infinity in tests
      inclusionRate = 0
    }
    return SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT + Math.floor(inclusionRate * INCLUSION_RATE_FACTOR) + (Math.min(entry.opsIncluded, 10000))
  }
}
