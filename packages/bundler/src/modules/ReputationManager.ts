import Debug from 'debug'
import { requireCond, tostr } from '../utils'
import { BigNumber } from 'ethers'
import { StakeInfo, ValidationErrors } from './Types'

const debug = Debug('aa.rep')

/**
 * throttled entities are allowed minimal number of entries per bundle. banned entities are allowed none
 */

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
  banSlack: 10
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
   */
  updateSeenStatus (addr?: string): void {
    if (addr == null) {
      return
    }
    const entry = this._getOrCreate(addr)
    entry.opsSeen++
    debug('after seen++', addr, entry)
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
    entry.opsSeen = 100
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
      this.entries[rep.address] = {
        address: rep.address,
        opsSeen: rep.opsSeen,
        opsIncluded: rep.opsIncluded
      }
    })
    return this.dump()
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
      `${title} ${info.addr} stake ${tostr(info.stake)} is too low (min=${tostr(this.minStake)})`,
      ValidationErrors.InsufficientStake)
    requireCond(BigNumber.from(info.unstakeDelaySec).gte(this.minUnstakeDelay),
      `${title} ${info.addr} unstake delay ${tostr(info.unstakeDelaySec)} is too low (min=${tostr(this.minUnstakeDelay)})`,
      ValidationErrors.InsufficientStake)
  }
}
