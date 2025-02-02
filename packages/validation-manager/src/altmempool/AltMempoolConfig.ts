import ow from 'ow'

import { ERC7562Rule } from '../enum/ERC7562Rule'

export type Role = 'sender' | 'paymaster' | 'factory'

export type EnterOpcode = 'CALL' | 'DELEGATECALL' | 'CALLCODE' | 'STATICCALL' | 'CREATE' | 'CREATE2'

export interface AltMempoolRuleExceptionBase {
  role?: Role
  address?: string
  depths?: number[]
  enterOpcode?: EnterOpcode[]
  enterMethodSelector?: `0x${string}`
}

export interface AltMempoolRuleExceptionBannedOpcode extends AltMempoolRuleExceptionBase {
  opcodes: string[]
  slots: Array<`0x${string}`>
}

type RuleException = `0x${string}` | Role | AltMempoolRuleExceptionBase | AltMempoolRuleExceptionBannedOpcode

export interface BaseAltMempoolRule {
  enabled?: boolean
  exceptions?: RuleException[]
}

export interface AltMempoolConfig {
  [mempoolId: string]: { [rule in ERC7562Rule]?: BaseAltMempoolRule }
}

const AltMempoolRuleExceptionBaseShape = ow.object.partialShape({
  role: ow.optional.string.oneOf(['sender', 'paymaster', 'factory']),
  address: ow.optional.string,
  depths: ow.optional.array.ofType(ow.number),
  enterOpcode: ow.optional.array.ofType(
    ow.string.oneOf(['CALL', 'DELEGATECALL', 'CALLCODE', 'STATICCALL', 'CREATE', 'CREATE2'])
  ),
  enterMethodSelector: ow.optional.string.matches(/^0x[a-fA-F0-9]+$/)
})

const AltMempoolRuleExceptionBannedOpcodeShape = ow.object.partialShape({
  ...AltMempoolRuleExceptionBaseShape,
  opcodes: ow.array.minLength(1).ofType(ow.string),
  slots: ow.array.minLength(1).ofType(ow.string.matches(/^0x[a-fA-F0-9]+$/))
})

const BaseAltMempoolRuleShape = ow.object.partialShape({
  enabled: ow.optional.boolean,
  exceptions: ow.optional.array.minLength(1).ofType(
    ow.any(
      ow.string.matches(/^0x[a-fA-F0-9]+$/),
      ow.string.oneOf(['sender', 'paymaster', 'factory']),
      AltMempoolRuleExceptionBaseShape,
      AltMempoolRuleExceptionBannedOpcodeShape
    )
  )
})

const AltMempoolConfigShape = ow.object.valuesOfType(ow.object.valuesOfType(BaseAltMempoolRuleShape))

export function validateAltMempoolConfigShape (config: AltMempoolConfig): void {
  ow(config, AltMempoolConfigShape)
}

// TODO: remove
const config: AltMempoolConfig = {
  1: {
    [ERC7562Rule.erep010]: {
      enabled: true,
      exceptions: [
        'sender',
        '0xdeadbeef',
        {
          depths: [3],
          enterOpcode: ['CALL'],
          opcodes: ['SSTORE', 'SLOAD'],
          slots: ['0xdeadbeef']
        }
      ]
    }
  }
}

validateAltMempoolConfigShape(config)

console.log(config)
