import Debug from 'debug'
import { mapOf } from '../utils'

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
  opsSeen: number
  opsIncluded: number
  status?: ReputationStatus
}

interface ReputationMap {
  [addr: string]: ReputationEntry
}

export interface ReputationDump {
  reputation: ReputationMap
}

export class ReputationManager {
  constructor (readonly params: ReputationParams) {
  }

  private entries: ReputationMap = {}
  // black-listed entities - always banned
  readonly blackList = new Set<string>()

  // white-listed entities - always OK.
  readonly whitelist = new Set<string>()

  /**
   * debug: dump reputation map (with updated "status" for each entry)
   */
  dump (): ReputationDump {
    return {
      reputation: mapOf(Object.keys(this.entries), addr => ({
        ...this.entries[addr],
        status: this.getStatus(addr)
      }))
    }
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
    const minExpectedIncluded = Math.min(entry.opsSeen / this.params.minInclusionDenominator)
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
  setReputation (reputationMap: ReputationDump): ReputationDump {
    Object.keys(reputationMap.reputation).forEach(addr => {
      const {
        opsSeen,
        opsIncluded
      } = reputationMap.reputation[addr]
      this.entries[addr] = {
        opsSeen,
        opsIncluded
      }
    })
    return this.dump()
  }
}
