import { ValidationErrors } from '@account-abstraction/utils'

import { ERC7562Rule } from './ERC7562Rule'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'

export interface ERC7562RuleViolation {
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
