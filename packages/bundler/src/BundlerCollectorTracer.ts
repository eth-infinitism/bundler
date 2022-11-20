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

export interface NumberLevelInfo {
  opcodes: { [opcode: string]: number }
  access: { [address: string]: AccessInfo }
}

export interface LogInfo {
  topics: string[]
  data: string
}

export interface BundlerCollectorReturn {
  numberLevels: { [key: string]: NumberLevelInfo }
  keccak: any[]
  calls: Array<{ type: string, from: string, to: string, value: any }>
  logs: LogInfo[]
  debug: any[]
}

interface BundlerCollectorTracer extends LogTracer, BundlerCollectorReturn {
  lastOp: string
  currentLevel: NumberLevelInfo
  numberCounter: number
  countSlot: (list: { [key: string]: number }, key: any) => void
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
    numberLevels: {},
    currentLevel: null as any,
    keccak: [],
    calls: [],
    logs: [],
    debug: [],
    lastOp: '',
    numberCounter: 0,

    fault (log: LogStep, db: LogDb): void {
      this.debug.push(['fault', log.getError()])
    },

    result (ctx: LogContext, db: LogDb): any {
      return {
        numberLevels: this.numberLevels,
        keccak: this.keccak,
        logs: this.logs,
        calls: this.calls,
        debug: this.debug // for internal debugging.
      }
    },

    enter (frame: LogCallFrame): void {
      this.debug.push(['enter', frame.getType()])
      this.calls.push({
        type: frame.getType(),
        from: toHex(frame.getFrom()),
        to: toHex(frame.getTo()),
        value: frame.getValue()
      })
    },
    exit (frame: LogFrameResult): void {
      this.debug.push(['exit', frame.getError(), frame.getGasUsed()])
    },
    countSlot (list: { [key: string]: number }, key: any) {
      list[key] = (list[key] || 0) + 1
    },
    step (log: LogStep, db: LogDb): any {
      const opcode = log.op.toString()
      if (opcode == 'NUMBER') this.numberCounter++
      if (this.numberLevels[this.numberCounter] == null) {
        this.currentLevel = this.numberLevels[this.numberCounter] = {
          access: {},
          opcodes: {}
        }
      }
      if (this.lastOp == 'GAS' && !opcode.includes('CALL')) {
        this.debug.push('lastop GAS cur=', opcode)
        this.countSlot(this.currentLevel.opcodes, 'GAS')
      }
      this.lastOp = opcode
      if (opcode != 'GAS' && log.getDepth() > 1) {
        //ignore "unimportant" opcodes:
        if (!opcode.match('^(DUP\d|PUSH\d|SWAP\d|ADD|SUB|MUL|EQ|LT|GT|SLT|SHR|AND|OR|NOT|ISZERO)$')) {
          this.countSlot(this.currentLevel.opcodes, opcode)
        }
      }

      if (opcode == 'SLOAD' || opcode == 'SSTORE') {
        const slot = log.stack.peek(0).toString(16)
        const addr = toHex(log.contract.getAddress())
        let access
        if ((access = this.currentLevel.access[addr]) == null) {
          this.currentLevel.access[addr] = access = {
            reads: {},
            writes: {}
          }
        }
        this.countSlot(opcode == 'SLOAD' ? access.reads : access.writes, slot)
      }

      if (opcode.startsWith('LOG')) {
        const count = parseInt(opcode.substring(3))
        const ofs = log.stack.peek(0)
        const len = log.stack.peek(1)
        const topics = []
        for (let i = 0; i < count; i++) {
          topics.push('0x' + log.stack.peek(2 + i).toString(16))
        }
        const data = toHex(log.memory.slice(ofs, ofs + len))
        this.logs.push({
          topics,
          data
        })
      }

      if (opcode == 'KECCAK256') {
        // collect keccak on 64-byte blocks
        const ofs = log.stack.peek(0)
        const len = log.stack.peek(1)
        //TODO: currently, solidity uses only 2-word for a key. this might change..
        if (len == 64 || true) {
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
