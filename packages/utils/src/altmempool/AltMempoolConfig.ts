type Role = 'sender' | 'paymaster' | 'factory'

type EnterOpcode = 'CALL' | 'DELEGATECALL' | 'CALLCODE' | 'STATICCALL' | 'CREATE' | 'CREATE2'

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

// TODO: define all current rules
type RuleERC7562 = 'erep010' | 'erep020'

export interface AltMempoolConfig {
  [mempoolId: number]: { [rule in RuleERC7562]?: BaseAltMempoolRule }
}

const config: AltMempoolConfig = {
  1: {
    erep010: {
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

console.log(config)
