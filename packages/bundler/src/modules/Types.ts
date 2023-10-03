import { BigNumberish } from 'ethers'

import { NotPromise } from '@account-abstraction/utils'
import { UserOperationStruct } from '@account-abstraction/contracts'

export enum ExecutionErrors {
  UserOperationReverted = -32521
}
export type UserOperation = NotPromise<UserOperationStruct>
