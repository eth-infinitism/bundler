// misc utilities for the various modules.

import { UserOperationStruct } from '@account-abstraction/contracts'
import { NotPromise } from '@account-abstraction/utils'
import { BytesLike } from 'ethers'
import { hexlify } from 'ethers/lib/utils'

export type UserOperation = NotPromise<UserOperationStruct>

export type SlotMap = { [slot: string]: string }

/**
 * map of storage
 * for each address, either a root hash, or a map of slot:value
 */
export type StorageMap = { [address: string]: string | SlotMap }

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
    if (typeof validationEntry == 'string') {
      // it's a root. override specific slots, if any
      mergedStorageMap[addr] = validationEntry
    } else if (typeof mergedStorageMap[addr] == 'string') {
      //merged address already contains a root. ignore specific slot values
    } else {
      let slots: SlotMap
      if (validationEntry == null) {
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
