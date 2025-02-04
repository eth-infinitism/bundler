import { ERC7562Rule } from '../enum/ERC7562Rule'

type Role = 'sender' | 'paymaster' | 'factory'

export type CallFrameType = 'CALL' | 'DELEGATECALL' | 'CALLCODE' | 'STATICCALL' | 'CREATE' | 'CREATE2'

export interface AltMempoolRuleExceptionBase {
  role?: Role
  address?: string
  depths?: number[]
  callFrameType?: CallFrameType[]
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
  [mempoolId: number]: { [rule in ERC7562Rule]?: BaseAltMempoolRule }
}

const config: AltMempoolConfig = {
  1: {
    [ERC7562Rule.erep010]: {
      enabled: true,
      exceptions: [
        'sender',
        '0xdeadbeef',
        {
          depths: [3],
          callFrameType: ['CALL'],
          opcodes: ['SSTORE', 'SLOAD'],
          slots: ['0xdeadbeef']
        }
      ]
    }
  }
}

console.log(config)
