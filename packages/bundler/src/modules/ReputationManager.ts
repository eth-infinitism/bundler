/**
 * throttled entities are allowed minimal number of entries per bundle. banned entities are allowed none
 */
import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { EntryPoint, IEntryPoint__factory } from '@account-abstraction/contracts'

enum ReputationStatus { OK, THROTTLED, BANNED }
interface ReputationEntry {
  opsSeen: number
  opsIncluded: number
  status?: ReputationStatus
}

interface ReputationDump {

}

export class ReputationManager {
  readonly entries = new Map<string, ReputationEntry>()
  //black-listed entities
  readonly blackList = new Set<string>()

  dump(): ReputationDump {
    return {} as ReputationDump
  }

  /**
   * exponential backoff of opsSeen and opsIncluded values
   */
  hourlyCron() {
    for (let key in this.entries.keys()) {
      const entry = this.entries.get(key)!
      entry.opsSeen = Math.floor(entry.opsSeen * 23/24)
      entry.opsIncluded = Math.floor(entry.opsSeen * 23/24)
      if ( entry.opsIncluded==0 && entry.opsSeen ==0 ) {
        this.entries.delete(key)
      }
    }
  }

  _getOrCreate(addr:string): ReputationEntry {
    let entry = this.entries.get(addr)
    if ( entry==null ) {
      entry = { opsSeen: 0, opsIncluded: 0, }
      this.entries.set(addr,entry)
    }
    return entry
  }
  updateSeenStatus(addr:string) {
    const entry = this._getOrCreate(addr)
    entry.opsSeen++
  }

  /**
   * found paymaster/deployer/agregator on-chain.
   * triggered by the EventsManager.
   * @param addr
   */
  updateIncludedStatus(addr:string) {
    const entry = this._getOrCreate(addr)
    entry.opsIncluded++
  }

  getStatus(addr: string ) :ReputationStatus {
    const entry = this.entries.get(addr)
    if ( entry==null ) {
      return ReputationStatus.OK
    }
    //TODO: calculate ratio
    return ReputationStatus.BANNED
  }
}
