import { NotPromise } from '@account-abstraction/utils'
import {
  IEntryPoint__factory,
  IPaymaster__factory,
  SenderCreator__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'
import {
  TestOpcodesAccountFactory__factory,
  TestOpcodesAccount__factory,
  TestStorageAccount__factory
} from '../types'

export enum ExecutionErrors {
  UserOperationReverted = -32521
}

export type UserOperation = NotPromise<UserOperationStruct>

export const abi = Object.values([
  ...TestOpcodesAccount__factory.abi,
  ...TestOpcodesAccountFactory__factory.abi,
  ...TestStorageAccount__factory.abi,
  ...SenderCreator__factory.abi,
  ...IEntryPoint__factory.abi,
  ...IPaymaster__factory.abi
].reduce((set, entry) => {
  const key = `${entry.name}(${entry.inputs.map(i => i.type).join(',')})`
  // console.log('key=', key, keccak256(Buffer.from(key)).slice(0,10))
  return {
    ...set,
    [key]: entry
  }
}, {})) as any
