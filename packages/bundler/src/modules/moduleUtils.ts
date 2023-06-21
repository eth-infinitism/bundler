// misc utilities for the various modules.

import {
  BytesLike,
  ContractFactory, ContractRunner,
  hexlify,
  Result
} from 'ethers'
import { SlotMap, StorageMap } from './Types'
import { tostr } from '../utils'

// extract address from initCode or paymasterAndData
export function getAddr (data?: BytesLike): string | undefined {
  if (data == null) {
    return undefined
  }
  const str = hexlify(data)
  if (str.length >= 42) {
    return str.slice(0, 42)
  }
  return undefined
}

/**
 * merge all validationStorageMap objects into merged map
 * - entry with "root" (string) is always preferred over entry with slot-map
 * - merge slot entries
 * NOTE: slot values are supposed to be the value before the transaction started.
 *  so same address/slot in different validations should carry the same value
 * @param mergedStorageMap
 * @param validationStorageMap
 */
export function mergeStorageMap (mergedStorageMap: StorageMap, validationStorageMap: StorageMap): StorageMap {
  Object.entries(validationStorageMap).forEach(([addr, validationEntry]) => {
    if (typeof validationEntry === 'string') {
      // it's a root. override specific slots, if any
      mergedStorageMap[addr] = validationEntry
    } else if (typeof mergedStorageMap[addr] === 'string') {
      // merged address already contains a root. ignore specific slot values
    } else {
      let slots: SlotMap
      if (mergedStorageMap[addr] == null) {
        slots = mergedStorageMap[addr] = {}
      } else {
        slots = mergedStorageMap[addr] as SlotMap
      }

      Object.entries(validationEntry).forEach(([slot, val]) => {
        slots[slot] = val
      })
    }
  })
  return mergedStorageMap
}

/**
 * run the constructor of the given type as a script: it is expected to revert with the script's return values.
 * @param provider provider to use for the call
 * @param c - contract factory of the script class
 * @param ctrParams constructor parameters
 * @return an array of arguments of the error
 * example usage:
 *     hashes = await runContractScript(provider, new GetUserOpHashes__factory(), [entryPoint.address, userOps]).then(ret => ret.userOpHashes)
 */
export async function runContractScript<T extends ContractFactory> (provider: ContractRunner, c: T, ctrParams: Parameters<T['getDeployTransaction']>): Promise<Result> {
  const tx = await c.getDeployTransaction(...ctrParams)
  const ret = await provider.call!(tx).catch(e => e.data.data ?? e.data)

  const parsed = c.interface.parseError(ret)
  if (parsed == null) throw new Error(`unable to parse script (error) response: ${tostr(ret)}`)
  return parsed.args
}
