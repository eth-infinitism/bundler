// javascript code of tracer function
// NOTE: we process this locally for hardhat, but send to geth for remote tracing.
// should NOT "require" anything, or use logs.
// see LogTrace for valid types (but alas, this one must be javascript, not typescript..

import { LogCallFrame, LogContext, LogDb, LogFrameResult, LogStep, LogTracer } from './GethTracer'

// toHex is available in a context of geth tracer
declare function toHex (a: any): string

/**
 * return type of our BundlerCollectorTracer.
 * collect access and opcodes, split into "levels" based on NUMBER opcode
 * keccak, calls and logs are collected globally, since the levels are unimportant for them.
 */
export interface BundlerCollectorReturn {
  /**
   * storage and opcode info, collected between "NUMBER" opcode calls (which is used as our "level marker")
   */
  numberLevels: { [numberOpcodeLevel: string]: NumberLevelInfo }
  /**
   * values passed into KECCAK opcode
   */
  keccak: string[]
  calls: Array<{ type: string, from: string, to: string, value: any }>
  logs: LogInfo[]
  debug: any[]
}

export interface NumberLevelInfo {
  opcodes: { [opcode: string]: number | undefined }
  access: { [address: string]: AccessInfo | undefined }
}

export interface AccessInfo {
  reads: { [slot: string]: number }
  writes: { [slot: string]: number }
}

export interface LogInfo {
  topics: string[]
  data: string
}

/**
 * type-safe local storage of our collector. contains all return-value properties.
 * (also defines all "trace-local" variables and functions)
 */
interface BundlerCollectorTracer extends LogTracer, BundlerCollectorReturn {
  lastOp: string
  currentLevel: NumberLevelInfo
  numberCounter: number
  countSlot: (list: { [key: string]: number | undefined }, key: any) => void
}

/**
 * tracer to collect data for opcode banning.
 * this method is passed as the "tracer" for eth_traceCall (note, the function itself)
 *
 * returned data:
 *  numberLevels: opcodes and memory access, split on execution of "number" opcode.
 *  keccak: input data of keccak opcode.
 *  calls: for each call, an array of [type, from, to, value]
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
      this.debug.push(['enter ' + frame.getType() + ' ' + toHex(frame.getTo()) + ' ' + toHex(frame.getInput()).slice(0, 100)])
      this.calls.push({
        type: frame.getType(),
        from: toHex(frame.getFrom()),
        to: toHex(frame.getTo()),
        value: frame.getValue()
      })
    },
    exit (frame: LogFrameResult): void {
      this.debug.push(`exit err=${frame.getError() as string}, gas=${frame.getGasUsed()}`)
    },

    // increment the "key" in the list. if the key is not defined yet, then set it to "1"
    countSlot (list: { [key: string]: number | undefined }, key: any) {
      list[key] = (list[key] ?? 0) + 1
    },
    step (log: LogStep, db: LogDb): any {
      const opcode = log.op.toString()
      // this.debug.push(this.lastOp + '-' + opcode + '-' + log.getDepth())
      if (opcode === 'NUMBER') this.numberCounter++
      if (this.numberLevels[this.numberCounter] == null) {
        this.currentLevel = this.numberLevels[this.numberCounter] = {
          access: {},
          opcodes: {}
        }
      }

      if (log.getDepth() === 1) {
        return
      }

      if (this.lastOp === 'GAS' && !opcode.includes('CALL')) {
        // count "GAS" opcode only if not followed by "CALL"
        this.countSlot(this.currentLevel.opcodes, 'GAS')
      }
      if (opcode !== 'GAS') {
        // ignore "unimportant" opcodes:
        if (opcode.match(/^(DUP\d+|PUSH\d+|SWAP\d+|POP|ADD|SUB|MUL|DIV|EQ|LTE?|S?GTE?|SLT|SH[LR]|AND|OR|NOT|ISZERO)$/) == null) {
          this.countSlot(this.currentLevel.opcodes, opcode)
        }
      }
      this.lastOp = opcode

      if (opcode === 'SLOAD' || opcode === 'SSTORE') {
        const slot = log.stack.peek(0).toString(16)
        const addr = toHex(log.contract.getAddress())
        let access
        if ((access = this.currentLevel.access[addr]) == null) {
          this.currentLevel.access[addr] = access = {
            reads: {},
            writes: {}
          }
        }
        this.countSlot(opcode === 'SLOAD' ? access.reads : access.writes, slot)
      }

      if (opcode === 'REVERT' || opcode === 'RETURN') {
        const ofs = parseInt(log.stack.peek(0).toString())
        const len = parseInt(log.stack.peek(1).toString())
        this.debug.push(opcode + ' ' + toHex(log.memory.slice(ofs, ofs + len)).slice(0, 100))
      } else if (opcode === 'KECCAK256') {
        // collect keccak on 64-byte blocks
        const ofs = parseInt(log.stack.peek(0).toString())
        const len = parseInt(log.stack.peek(1).toString())
        // currently, solidity uses only 2-word (6-byte) for a key. this might change..
        // still, no need to return too much
        if (len < 512) {
          // if (len == 64) {
          this.keccak.push(toHex(log.memory.slice(ofs, ofs + len)))
        }
      } else if (opcode.startsWith('LOG')) {
        const count = parseInt(opcode.substring(3))
        const ofs = parseInt(log.stack.peek(0).toString())
        const len = parseInt(log.stack.peek(1).toString())
        const topics = []
        for (let i = 0; i < count; i++) {
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          topics.push('0x' + log.stack.peek(2 + i).toString(16))
        }
        const data = toHex(log.memory.slice(ofs, ofs + len))
        this.logs.push({
          topics,
          data
        })
      }
    }
  }
}
