// misc utilities for the various modules.

import { BytesLike, ContractFactory, BigNumber, ethers } from 'ethers'
import { hexConcat, hexlify, hexZeroPad, Result } from 'ethers/lib/utils'
import { Provider, JsonRpcProvider } from '@ethersproject/providers'
import { BigNumberish } from 'ethers/lib/ethers'

import { NotPromise, packUserOp } from './ERC4337Utils'
import { PackedUserOperationStruct } from './soltypes'
import { UserOperation } from './interfaces/UserOperation'
import { OperationBase } from './interfaces/OperationBase'
import { OperationRIP7560 } from './interfaces/OperationRIP7560'
import { EIP7702Authorization } from './interfaces/EIP7702Authorization'
import { IEntryPoint } from './types'

export const EIP_7702_MARKER_CODE = '0xef0100'
export const EIP_7702_MARKER_INIT_CODE = '0x7702'

export interface SlotMap {
  [slot: string]: string
}

/**
 * map of storage
 * for each address, either a root hash, or a map of slot:value
 */
export interface StorageMap {
  [address: string]: string | SlotMap
}

export interface StakeInfo {
  addr: string
  stake: BigNumberish
  unstakeDelaySec: BigNumberish
}

export interface PaymasterValidationInfo extends StakeInfo {
  context?: string
}

export type PackedUserOperation = NotPromise<PackedUserOperationStruct>

export enum ValidationErrors {

  // standard EIP-1474 errors:
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidFields = -32602,
  InternalError = -32603,

  // ERC-4337 errors:
  SimulateValidation = -32500,
  SimulatePaymasterValidation = -32501,
  OpcodeValidation = -32502,
  NotInTimeRange = -32503,
  Reputation = -32504,
  InsufficientStake = -32505,
  UnsupportedSignatureAggregator = -32506,
  InvalidSignature = -32507,
  PaymasterDepositTooLow = -32508,
  UserOperationReverted = -32521
}

export interface ReferencedCodeHashes {
  // addresses accessed during this user operation
  addresses: string[]

  // keccak over the code of all referenced addresses
  hash: string
}

export class RpcError extends Error {
  // error codes from: https://eips.ethereum.org/EIPS/eip-1474
  constructor (msg: string, readonly code: number, readonly data: any = undefined) {
    super(msg)
  }
}

export function tostr (s: BigNumberish): string {
  return BigNumber.from(s).toString()
}

export function requireCond (cond: boolean, msg: string, code: number, data: any = undefined): void {
  if (!cond) {
    throw new RpcError(msg, code, data)
  }
}

// verify that either address field exist along with "mustFields",
// or address field is missing, and none of the must (or optional) field also exists
export function requireAddressAndFields (userOp: OperationBase, addrField: string, mustFields: string[], optionalFields: string[] = []): void {
  const op = userOp as any
  const addr = op[addrField]
  if (addr == null) {
    const unexpected = Object.entries(op)
      .filter(([name, value]) => value != null && (mustFields.includes(name) || optionalFields.includes(name)))
    requireCond(unexpected.length === 0,
      `no ${addrField} but got ${unexpected.join(',')}`, ValidationErrors.InvalidFields)
  } else {
    requireCond(addr.match(/^0x[a-f0-9]{10,40}$/i), `invalid ${addrField}`, ValidationErrors.InvalidFields)
    const missing = mustFields.filter(name => op[name] == null)
    requireCond(missing.length === 0,
      `got ${addrField} but missing ${missing.join(',')}`, ValidationErrors.InvalidFields)
  }
}

/**
 * create a dictionary object with given keys
 * @param keys the property names of the returned object
 * @param mapper mapper from key to property value
 * @param filter if exists, must return true to add keys
 */
export function mapOf<T> (keys: Iterable<string>, mapper: (key: string) => T, filter?: (key: string) => boolean): {
  [key: string]: T
} {
  const ret: { [key: string]: T } = {}
  for (const key of keys) {
    if (filter == null || filter(key)) {
      ret[key] = mapper(key)
    }
  }
  return ret
}

export async function sleep (sleepTime: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, sleepTime))
}

export async function waitFor<T> (func: () => T | undefined, timeout = 10000, interval = 500): Promise<T> {
  const endTime = Date.now() + timeout
  while (true) {
    const ret = await func()
    if (ret != null) {
      return ret
    }
    if (Date.now() > endTime) {
      throw new Error(`Timed out waiting for ${func as unknown as string}`)
    }
    await sleep(interval)
  }
}

export async function supportsRpcMethod (provider: JsonRpcProvider, method: string, params: any[]): Promise<boolean> {
  const ret = await provider.send(method, params).catch(e => e)
  const code = ret.error?.code ?? ret.code
  return code === -32602 // wrong params (meaning, method exists)
}

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
        slots = mergedStorageMap[addr]
      }

      Object.entries(validationEntry).forEach(([slot, val]) => {
        slots[slot] = val
      })
    }
  })
  return mergedStorageMap
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

/**
 * sum the given bignumberish items (numbers, hex, bignumbers, ignore nulls)
 */
export function sum (...args: Array<BigNumberish | undefined>): BigNumber {
  return args.reduce((acc: BigNumber, cur) => acc.add(cur ?? 0), BigNumber.from(0))
}

/**
 * calculate the maximum cost of a UserOperation.
 * the cost is the sum of the verification gas limits and call gas limit, multiplied by the maxFeePerGas.
 * @param userOp
 */
export function getUserOpMaxCost (userOp: OperationBase): BigNumber {
  const preVerificationGas: BigNumberish = (userOp as UserOperation).preVerificationGas
  return sum(
    preVerificationGas ?? 0,
    userOp.verificationGasLimit,
    userOp.callGasLimit,
    userOp.paymasterVerificationGasLimit ?? 0,
    userOp.paymasterPostOpGasLimit ?? 0
  ).mul(userOp.maxFeePerGas)
}

export function getPackedNonce (userOp: OperationBase): BigNumber {
  const nonceKey = (userOp as OperationRIP7560).nonceKey
  if (nonceKey == null || BigNumber.from(nonceKey).eq(0)) {
    // Either not RIP-7560 operation or not using RIP-7712 nonce
    return BigNumber.from(userOp.nonce)
  }
  const packed = ethers.utils.solidityPack(['uint192', 'uint64'], [nonceKey, userOp.nonce])
  const bigNumberNonce = BigNumber.from(packed)
  return bigNumberNonce
}

export function getAuthorizationList (op: OperationBase): EIP7702Authorization[] {
  const userOp = op as UserOperation
  if (userOp.eip7702Auth != null) {
    return [userOp.eip7702Auth]
  } else {
    return (op as OperationRIP7560).authorizationList ?? []
  }
}

// call entryPoint.getUserOpHash, but use state-override to run it with specific code (e.g. eip-7702 delegate) on the sender's code.
export async function callGetUserOpHashWithCode (entryPoint: IEntryPoint, userOp: UserOperation): Promise<string> {
  let stateOverride = null
  if (userOp.eip7702Auth != null) {
    const deployedDelegateCode: string = hexConcat([EIP_7702_MARKER_CODE, userOp.eip7702Auth.address])
    stateOverride = {
      [userOp.sender]: {
        code: deployedDelegateCode
      }
    }
  }
  return await (entryPoint.provider as JsonRpcProvider).send('eth_call', [
    {
      to: entryPoint.address,
      data: entryPoint.interface.encodeFunctionData('getUserOpHash', [packUserOp(userOp)])
    }, 'latest', stateOverride
  ])
}
