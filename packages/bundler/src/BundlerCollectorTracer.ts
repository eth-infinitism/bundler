// javascript code of tracer function
// NOTE: we process this locally for hardhat, but send to geth for remote tracing.
// should NOT "require" anything, or use logs.
// see LogTrace for valid types (but alas, this one must be javascript, not typescript..

import { LogCallFrame, LogContext, LogDb, LogFrameResult, LogStep, LogTracer } from './GethTracer'

// functions available in a context of geth tracer
declare function toHex (a: any): string

declare function toWord (a: any): string

declare function toAddress (a: any): string

declare function isPrecompiled (addr: any): boolean

/**
 * return type of our BundlerCollectorTracer.
 * collect access and opcodes, split into "levels" based on NUMBER opcode
 * keccak, calls and logs are collected globally, since the levels are unimportant for them.
 */
export interface BundlerCollectorReturn {
  /**
   * storage and opcode info, collected between "NUMBER" opcode calls (which is used as our "level marker")
   */
  numberLevels: NumberLevelInfo[]
  /**
   * values passed into KECCAK opcode
   */
  keccak: string[]
  calls: Array<ExitInfo | MethodInfo>
  logs: LogInfo[]
  debug: any[]
}

export interface MethodInfo {
  type: string
  from: string
  to: string
  method: string
  value: any
  gas: number
}

export interface ExitInfo {
  type: 'REVERT' | 'RETURN'
  gasUsed: number
  data: string
}

export interface NumberLevelInfo {
  opcodes: { [opcode: string]: number }
  access: { [address: string]: AccessInfo }
  contractSize: { [addr: string]: number }
  oog?: boolean
}

export interface AccessInfo {
  // slot value, just prior this operation
  reads: { [slot: string]: string }
  // count of writes.
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
    numberLevels: [],
    currentLevel: null as any,
    keccak: [],
    calls: [],
    logs: [],
    debug: [],
    lastOp: '',
    numberCounter: 0,

    fault (log: LogStep, db: LogDb): void {
      this.debug.push('fault depth=', log.getDepth(), ' gas=', log.getGas(), ' cost=', log.getCost(), ' err=', log.getError())
    },

    result (ctx: LogContext, db: LogDb): BundlerCollectorReturn {
      return {
        numberLevels: this.numberLevels,
        keccak: this.keccak,
        logs: this.logs,
        calls: this.calls,
        debug: this.debug // for internal debugging.
      }
    },

    enter (frame: LogCallFrame): void {
      // this.debug.push('enter gas=', frame.getGas(), ' type=', frame.getType(), ' to=', toHex(frame.getTo()), ' in=', toHex(frame.getInput()).slice(0, 500))
      this.calls.push({
        type: frame.getType(),
        from: toHex(frame.getFrom()),
        to: toHex(frame.getTo()),
        method: toHex(frame.getInput()).slice(0, 10),
        gas: frame.getGas(),
        value: frame.getValue()
      })
    },
    exit (frame: LogFrameResult): void {
      this.calls.push({
        type: frame.getError() != null ? 'REVERT' : 'RETURN',
        gasUsed: frame.getGasUsed(),
        data: toHex(frame.getOutput()).slice(0, 4000)
      })
    },

    // increment the "key" in the list. if the key is not defined yet, then set it to "1"
    countSlot (list: { [key: string]: number | undefined }, key: any) {
      list[key] = (list[key] ?? 0) + 1
    },
    step (log: LogStep, db: LogDb): any {
      const opcode = log.op.toString()
      // this.debug.push(this.lastOp + '-' + opcode + '-' + log.getDepth() + '-' + log.getGas() + '-' + log.getCost())
      if (log.getGas() < log.getCost()) {
        this.currentLevel.oog = true
      }

      if (opcode === 'REVERT' || opcode === 'RETURN') {
        if (log.getDepth() === 1) {
          // exit() is not called on top-level return/revent, so we reconstruct it
          // from opcode
          const ofs = parseInt(log.stack.peek(0).toString())
          const len = parseInt(log.stack.peek(1).toString())
          const data = toHex(log.memory.slice(ofs, ofs + len)).slice(0, 4000)
          // this.debug.push(opcode + ' ' + data)
          this.calls.push({
            type: opcode,
            gasUsed: 0,
            data
          })
        }
      }

      if (opcode.match(/^(EXT.*|CALL|CALLCODE|DELEGATECALL|STATICCALL)$/) != null) {
        // this.debug.push('op=' + opcode + ' last=' + this.lastOp + ' stacksize=' + log.stack.length())
        const idx = opcode.startsWith('EXT') ? 0 : 1
        const addr = toAddress(log.stack.peek(idx).toString(16))
        const addrHex = toHex(addr)
        if ((this.currentLevel.contractSize[addrHex] ?? 0) === 0 && !isPrecompiled(addr)) {
          this.currentLevel.contractSize[addrHex] = db.getCode(addr).length
        }
      }

      if (log.getDepth() === 1) {
        // NUMBER opcode at top level split levels
        if (opcode === 'NUMBER') this.numberCounter++
        if (this.numberLevels[this.numberCounter] == null) {
          this.currentLevel = this.numberLevels[this.numberCounter] = {
            access: {},
            opcodes: {},
            contractSize: {}
          }
        }
        this.lastOp = ''
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
        const slot = toWord(log.stack.peek(0).toString(16))
        const slotHex = toHex(slot)
        const addr = log.contract.getAddress()
        const addrHex = toHex(addr)
        let access = this.currentLevel.access[addrHex] as any
        if (access == null) {
          access = {
            reads: {},
            writes: {}
          }
          this.currentLevel.access[addrHex] = access
        }
        if (opcode === 'SLOAD') {
          // read slot values before this UserOp was created
          // (so saving it if it was written before the first read)
          if (access.reads[slotHex] == null && access.writes[slotHex] == null) {
            access.reads[slotHex] = toHex(db.getState(addr, slot))
          }
        } else {
          this.countSlot(access.writes, slotHex)
        }
      }

      if (opcode === 'KECCAK256') {
        // collect keccak on 64-byte blocks
        const ofs = parseInt(log.stack.peek(0).toString())
        const len = parseInt(log.stack.peek(1).toString())
        // currently, solidity uses only 2-word (6-byte) for a key. this might change..
        // still, no need to return too much
        if (len > 20 && len < 512) {
          // if (len === 64) {
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
