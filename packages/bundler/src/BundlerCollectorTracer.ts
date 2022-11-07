// javascript code of tracer function
// NOTE: we process this locally for hardhat, but send to geth for remote tracing.
// should NOT "require" anything, or use logs.
// see LogTrace for valid types (but alas, this one must be javascript, not typescript..

import { LogCallFrame, LogContext, LogDb, LogFrameResult, LogStep, LogTracer } from './GethTracer'
import { hexlify } from 'ethers/lib/utils'

// toHex is available in a context of geth tracer
function toHex (a: any): string {
  return hexlify(a)
}

export interface AccessInfo {
  reads: { [slot: string]: number }
  writes: { [slot: string]: number }
}

export interface BundlerCollectorReturn {
  opcodes: { [opcode: string]: number }
  keccak: any[]
  calls: Array<{ type: string, from: string, to: string, value: any }>
  logs: any[]
  access: { [address: string]: AccessInfo }
}

interface BundlerCollectorTracer extends LogTracer, BundlerCollectorReturn {
  lastOp: string
  countSlot: (list: any, key: any) => void
}

/**
 * tracer to collect data for opcode banning.
 * exported object for internal use: remove the "module.exports=" when sending as a string to geth.
 * returned data:
 *  opcodes: mapping from opcode name to count
 *  keccak: whenever a keccak over a 64-byte memory is done, collect the 64 bytes (as 2 32-byte uint values)
 *  calls: for each call, an array of [type, from, to, value]
 *  writes: count writes in contract addresses (not slots)
 *  reads: count reads on contract addresses
 *  slots: accessed slots (on any address)
 */
export function bundlerCollectorTracer (): BundlerCollectorTracer {
  return {
    opcodes: {},
    keccak: [],
    calls: [],
    logs: [],
    access: {},
    lastOp: '',

    fault (log: LogStep, db: LogDb): void {
      this.logs.push(['fault', log.getError()])
    },

    result (ctx: LogContext, db: LogDb): any {
      return {
        access: this.access,
        keccak: this.keccak,
        calls: this.calls,
        opcodes: this.opcodes,
        logs: this.logs // for internal debugging.
      }
    },

    enter (frame: LogCallFrame): void {
      this.calls.push({
        type: frame.getType(),
        from: toHex(frame.getFrom()),
        to: toHex(frame.getTo()),
        value: frame.getValue()
      })
    },
    exit (frame: LogFrameResult): void {
    },
    countSlot (list: any, key: any) {
      list[key] = (list[key] || 0) + 1
    },
    step (log: LogStep, db: LogDb): any {
      const opcode = log.op.toString()
      if (this.lastOp == 'GAS' && !opcode.includes('CALL')) {
        this.logs.push('lastop GAS cur=', opcode)
        this.countSlot(this.opcodes, 'GAS1')
      }
      this.lastOp = opcode
      if (opcode != 'GAS') {
        this.countSlot(this.opcodes, opcode)
      }

      if (opcode == 'SLOAD' || opcode == 'SSTORE') {
        const slot = log.stack.peek(0).toString(16)
        const addr = toHex(log.contract.getAddress())
        let access
        if ((access = this.access[addr]) == null) {
          this.access[addr] = access = {
            reads: {},
            writes: {}
          }
        }
        this.countSlot(opcode == 'SLOAD' ? access.reads : access.writes, slot)
      }

      const OPCODE_KECCAK = 0x20
      if (log.op.toNumber() == OPCODE_KECCAK) {
        // collect keccak on 64-byte blocks
        const ofs = log.stack.peek(0)
        const len = log.stack.peek(1)
        if (len == 64) {
          this.keccak.push(toHex(log.memory.slice(ofs, ofs + len)))
          //   [
          //   log.memory.getUint(ofs).toString(16),
          //   log.memory.getUint(ofs + 32).toString(16)
          // ])
        }
      }
    }
  }
}
