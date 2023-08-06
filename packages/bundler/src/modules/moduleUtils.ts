// misc utilities for the various modules.

import { BytesLike, ContractFactory } from 'ethers'
import { hexlify, hexZeroPad, Result } from 'ethers/lib/utils'
import { KnownAccount, StorageMap } from './Types'
import { Provider } from '@ethersproject/providers'

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
export function mergeStorageMap(mergedStorageMap: StorageMap, validationStorageMap: StorageMap): StorageMap {
  Object.entries(validationStorageMap).forEach(([addr, validationEntry]) => {
    if (validationEntry.StorageRoot) {
      // If there's a storage root, override specific slots, if any
      mergedStorageMap[addr] = { StorageRoot: validationEntry.StorageRoot };
    } else if (mergedStorageMap[addr]?.StorageRoot) {
      // If the merged address already contains a root, ignore specific slot values
    } else {
      let knownAccount: KnownAccount;
      if (mergedStorageMap[addr] == null) {
        knownAccount = mergedStorageMap[addr] = {};
      } else {
        knownAccount = mergedStorageMap[addr];
      }

      // If there are storage slots, merge them
      if (validationEntry.StorageSlots) {
        knownAccount.StorageSlots = knownAccount.StorageSlots || {};
        Object.entries(validationEntry.StorageSlots).forEach(([slot, val]) => {
          knownAccount.StorageSlots![slot] = val;
        });
      }
    }
  });
  return mergedStorageMap;
}

export function toBytes32 (b: BytesLike | number): string {
  return hexZeroPad(hexlify(b).toLowerCase(), 32)
}

/**
 * run the constructor of the given type as a script: it is expected to revert with the script's return values.
 * @param provider provider to use fo rthe call
 * @param c - contract factory of the script class
 * @param ctrParams constructor parameters
 * @return an array of arguments of the error
 * example usasge:
 *     hashes = await runContractScript(provider, new GetUserOpHashes__factory(), [entryPoint.address, userOps]).then(ret => ret.userOpHashes)
 */
export async function runContractScript<T extends ContractFactory> (provider: Provider, c: T, ctrParams: Parameters<T['getDeployTransaction']>): Promise<Result> {
  const tx = c.getDeployTransaction(...ctrParams)
  const ret = await provider.call(tx)
  const parsed = ContractFactory.getInterface(c.interface).parseError(ret)
  if (parsed == null) throw new Error('unable to parse script (error) response: ' + ret)
  return parsed.args
}
