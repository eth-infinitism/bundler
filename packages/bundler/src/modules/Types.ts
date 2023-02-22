import { BigNumberish } from 'ethers'
import { NotPromise } from '@account-abstraction/utils'
import { UserOperationStruct } from '@account-abstraction/contracts'

export enum ValidationErrors {
  InvalidFields = -32602,
  SimulateValidation = -32500,
  SimulatePaymasterValidation = -32501,
  OpcodeValidation = -32502,
  ExpiresShortly = -32503,
  Reputation = -32504,
  InsufficientStake = -32505,
  UnsupportedSignatureAggregator = -32506,
  InvalidSignature = -32507,
}

export enum ExecutionErrors {
  UserOperationReverted = -32521
}

export interface StakeInfo {
  addr: string
  stake: BigNumberish
  unstakeDelaySec: BigNumberish
}

export interface ReferencedCodeHashes {
  // addresses accessed during this user operation
  addresses: string[]

  // keccak over the code of all referenced addresses
  hash: string
}

export type UserOperation = NotPromise<UserOperationStruct>

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
