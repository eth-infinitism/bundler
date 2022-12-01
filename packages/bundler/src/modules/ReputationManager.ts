/**
 * throttled entities are allowed minimal number of entries per bundle. banned entities are allowed none
 */

export enum ReputationStatus { OK, THROTTLED, BANNED }

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

interface ReputationDump {
  reputation: { [addr: string]: ReputationEntry }
}

export class ReputationManager {
  constructor (readonly params: ReputationParams) {
  }

  readonly entries: { [addr: string]: ReputationEntry } = {}
  // black-listed entities
  readonly blackList = new Set<string>()

  dump (): ReputationDump {
    return {
      reputation: Object.keys(this.entries)
        .reduce((set, addr) => ({
          ...set,
          [addr]: {
            ...this.entries[addr],
            status: this.getStatus(addr)
          }
        }), {})
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

  _getOrCreate (addr: string): ReputationEntry {
    let entry = this.entries[addr]
    if (entry == null) {
      entry = {
        opsSeen: 0,
        opsIncluded: 0
      }
      this.entries[addr] = entry
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
  }

  /**
   * found paymaster/deployer/agregator on-chain.
   * triggered by the EventsManager.
   * @param addr
   */
  updateIncludedStatus (addr: string): void {
    const entry = this._getOrCreate(addr)
    entry.opsIncluded++
  }

  // https://github.com/eth-infinitism/account-abstraction/blob/develop/eip/EIPS/eip-4337.md#reputation-scoring-and-throttlingbanning-for-paymasters
  getStatus (addr?: string): ReputationStatus {
    if (addr == null) {
      return ReputationStatus.OK
    }
    const entry = this.entries[addr]
    if (entry == null) {
      return ReputationStatus.OK
    }
    const minExpectedIncluded = Math.min(entry.opsSeen / this.params.minInclusionDenominator)
    if (minExpectedIncluded >= entry.opsIncluded + this.params.throttlingSlack) {
      return ReputationStatus.OK
    } else if (minExpectedIncluded <= entry.opsIncluded + this.params.banSlack) {
      return ReputationStatus.THROTTLED
    } else {
      return ReputationStatus.BANNED
    }
  }
}
