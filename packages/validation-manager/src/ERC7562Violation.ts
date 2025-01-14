import { RpcError, ValidationErrors } from '@account-abstraction/utils'

import { ERC7562Rule } from './enum/ERC7562Rule'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'

export interface ERC7562Violation {
  rule: ERC7562Rule
  depth: number
  entity: AccountAbstractionEntity
  address: string
  errorCode: ValidationErrors
  description: string
  conflict?: string
  opcode?: string
  value?: string
  slot?: string
}

export function toError (violation: ERC7562Violation): Error {
  return new RpcError(violation.description, violation.errorCode)
}
