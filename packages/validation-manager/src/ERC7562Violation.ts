import { RpcError, ValidationErrors } from '@account-abstraction/utils'

import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { ERC7562Rule } from './enum/ERC7562Rule'
import { CallFrameType } from './altmempool/AltMempoolConfig'

export interface ERC7562Violation {
  rule: ERC7562Rule
  depth: number
  entity: AccountAbstractionEntity
  address: string
  delegatecallStorageAddress: string
  errorCode: ValidationErrors
  description: string
  callFrameType: CallFrameType
  conflict?: string
  opcode?: string
  value?: string
  slot?: string
}

export function toError (violation: ERC7562Violation): Error {
  return new RpcError(violation.description, violation.errorCode)
}
