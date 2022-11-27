// attempt to run manually a tracer on a TraceResult data chunk.
// this is an inefficient version, since it requires full trace dump (can easily be 10Mb) to be returned
// from node, and processed locally.
// needed only for testing using local hardhat, which doesn't support javascript "tracer"
//   (which is annoying, since it IS a javascript evm...)
// INCOMPLETE: can't easily emulate "contract" methods (e.g. getAddress) without full emulating full CALL/RETURN/REVERT state
import { BigNumber, Transaction } from 'ethers'
import { hexConcat, keccak256 } from 'ethers/lib/utils'
import { LogCallFrame, LogStep, LogTracer, TraceOptions, TraceResult, TraceResultEntry } from './GethTracer'

/* eslint-disable */

// must have this method, so that "eval" below will find it.
declare function toHex (a: any): string

class Stack<T> {
  values: T[] = []

  push (...item: T[]) {
    this.values.push(...item)
  }

  top (): T {
    return this.values[this.values.length - 1]
  }

  pop (): T | undefined {
    return this.values.pop()
  }

  depth (): number {
    return this.values.length
  }
}

/**
 * locally execute a tracer on raw TraceResult's 'structLog'
 * This is VERY inefficient, since it requires a full structLog, including stack and storage.
 * @param tx
 * @param res
 * @param options
 * @constructor
 */
export function MockTracer (tx: Transaction, res: TraceResult, options: TraceOptions): TraceResult | any {
  // no tracer. leave unchanged.
  if (options.tracer == null) {
    return res
  }

  let tracer: LogTracer = {} as any

  if (typeof options.tracer === 'object') {
    tracer = options.tracer
  } else {
    try {
      console.log('evaluating', options.tracer)
      eval('tracer=' + options.tracer)
      console.log('post-eval tracer=', tracer)
    } catch (e: any) {
      console.log('failed to parse: ', options.tracer)
      throw (e)
    }
  }
  const NONE = null as any
  // TODO: where we get config from? params?
  const config = NONE
  if (tracer.setup != null) {
    tracer.setup(config)
  }
  let currentLogEntry: TraceResultEntry = {} as any
  const callstack = new Stack<LogCallFrame>()

  callstack.push(new LogCallFrame(
    'CALL',
    tx.from!,
    tx.to!,
    tx.value,
    tx.data,
    tx.gasPrice!
  ))

  const step: LogStep = {
    op: {
      isPush (): boolean {
        return currentLogEntry.op.startsWith('PUSH')
      },
      toNumber (): number {
        // hack: we don't need all codes. only of keccak
        if (currentLogEntry.op in ['KECCAK256', 'SHA3']) {
          return 0x20
        }
        return -1
      },
      toString (): string {
        return currentLogEntry.op
      }
    },
    memory: {
      slice (start: number, stop: number): any {
        throw new Error('slice: unimpl')
        /*
        console.log('slice', stop, stop)
        // inclusive offsets into the array of 32-byte words
        const istart = Math.floor(start / 32)
        const istop = Math.ceil(stop / 32)
        //byte offset from the first 32-byte word
        const ioffset = start - istart * 32
        console.log('xx', {
          start,
          stop,
          istart,
          istop,
          ioffset
        })
        // slice the words array, join as hex string
        const memorySlice = currentLogEntry.memory?.slice(istart, istop).join()
        // join memory slice
        return memorySlice?.slice(ioffset * 2, (stop - start) * 2)
         */
      },
      getUint (offset: number): string {
        return currentLogEntry.memory?.[offset]!
      },
      length (): number {
        return currentLogEntry.memory?.length!
      }
    },
    contract: {
      getInput (): any {
        return callstack.top().input
      },
      getValue (): BigNumber {
        return callstack.top().value
      },
      getCaller (): any {
        return callstack.top().caller
      },
      getAddress (): string {
        return callstack.top().address
      }
    },
    stack: {
      peek (idx: number): BigNumber {
        return BigNumber.from('0x' + currentLogEntry.stack?.[currentLogEntry.stack?.length - idx - 1])
      },
      length (): number {
        return currentLogEntry.stack.length
      }
    },
    getPC () {
      return currentLogEntry.pc
    },
    getGas (): number {
      return currentLogEntry.gas
    },
    getCost (): number {
      return currentLogEntry.gasCost
    },
    getDepth (): number {
      return currentLogEntry.depth
    },
    getRefund (): number {
      throw new Error('unhandled')
    },
    getError (): any {
      return undefined
    }
  }
  res.structLogs.forEach(log => {
    // note: "step" can be references only  after setting currentLogEntry
    currentLogEntry = log
    const depth = callstack.depth()
    switch (log.op) {
      case 'CALLCODE':
        throw new Error('unsupported: CALLCODE')
      case 'CREATE':
        throw new Error('unsupported: CREATE')
      case 'CREATE2': {
        const [salt, len, offset, value] = currentLogEntry.stack.slice(-4)
        const ctr = step.memory.slice(parseInt(offset), parseInt(len))
        // todo: check create2 address...
        const addr = hexConcat(['0xff', keccak256(hexConcat([
          keccak256(ctr), callstack.top().address, salt]))])
        callstack.push(new LogCallFrame('CALL',
          callstack.top().address,
          addr,
          BigNumber.from(value),
          'todo: extract input from memory',
          BigNumber.from(log.gas)
        ))
        break
      }
      case 'CALL': {
        const [gas, addr, value] = currentLogEntry.stack.slice(-3)
        callstack.push(new LogCallFrame('CALL',
          callstack.top().address,
          addr,
          BigNumber.from(value),
          'todo: extract input from memory',
          BigNumber.from(gas)
        ))
        break
      }
      case 'STATICCALL': {
        const [gas, addr] = currentLogEntry.stack.slice(-2)
        callstack.push(new LogCallFrame('CALL',
          callstack.top().address,
          addr,
          BigNumber.from(0),
          'todo: extract input from memory',
          BigNumber.from(gas)
        ))
        break
      }
      case 'DELEGATECALL': {
        const [gas, addr] = currentLogEntry.stack.slice(-2)
        callstack.push(new LogCallFrame('CALL',
          callstack.top().caller,
          callstack.top().address,
          BigNumber.from(0),
          'todo: extract input from memory',
          BigNumber.from(gas)
        ))
        break
      }
      case 'RETURN':
      case 'REVERT': {
        callstack.pop()
      }
    }
    if (callstack.depth() !== depth && tracer.enter != null) {
      tracer.enter(callstack.top())
    }
    if (tracer.step != null) {
      tracer.step(step, NONE)
    }
  })

  return tracer.result(NONE, NONE)
}
