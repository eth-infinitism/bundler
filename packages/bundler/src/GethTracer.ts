import { JsonRpcProvider, TransactionRequest } from '@ethersproject/providers'
import { BigNumber, Transaction } from 'ethers'
import { Deferrable } from '@ethersproject/properties'
import { hexConcat, hexlify, keccak256, resolveProperties } from 'ethers/lib/utils'
import { bundlerCollectorTracer } from './BundlerCollectorTracer'
// from:https://geth.ethereum.org/docs/rpc/ns-debug#javascript-based-tracing
//

/**
 * a function returning a LogTracer.
 * the function's body must be "{ return {...} }"
 * (its OK if original function was in typescript: we extract its value as javascript
 */
type LogTracerFunc = () => LogTracer

export async function debug_traceCall (provider: JsonRpcProvider, tx: Deferrable<TransactionRequest>, options: TraceOptions): Promise<TraceResult | any> {
  const tx1 = await resolveProperties(tx)
  const ret = await provider.send('debug_traceCall', [tx1, 'latest', tracer2string(options)])
  // return applyTracer(ret, options)
  return ret
}

// a hack for network that doesn't have traceCall: mine the transaction, and use debug_traceTransaction
export async function execAndTrace (provider: JsonRpcProvider, tx: Deferrable<TransactionRequest>, options: TraceOptions): Promise<TraceResult | any> {
  const hash = await provider.getSigner().sendUncheckedTransaction(tx)
  return await debug_traceTransaction(provider, hash, options)
}

export async function debug_traceTransaction (provider: JsonRpcProvider, hash: string, options: TraceOptions): Promise<TraceResult | any> {
  const ret = await provider.send('debug_traceTransaction', [hash, tracer2string(options)])
  // const tx = await provider.getTransaction(hash)
  // return applyTracer(tx, ret, options)
  return ret
}

/**
 * extract the body of "LogTracerFunc".
 * note that we extract the javascript body, even if the function was created as typescript
 * @param func
 */
export function getTracerBodyString (func: LogTracerFunc): string {
  const tracerFunc = func.toString()
  // function must return a plain object:
  //  function xyz() { return {...}; }
  const regexp = /function \w+\s*\(\s*\)\s*{\s*return\s*(\{[\s\S]+\});?\s*\}\s*$/ // (\{[\s\S]+\}); \} $/
  const match = tracerFunc.match(regexp)
  if (match == null) {
    throw new Error('Not a simple method returning value')
  }
  return match[1]
}

function tracer2string (options: TraceOptions): TraceOptions {
  if (typeof options.tracer === 'function') {
    return {
      ...options,
      tracer: getTracerBodyString(options.tracer)
    }
  } else {
    return options
  }
}

// must have this method, so that "eval" below will find it.
function toHex (s: any): any {
  return hexlify(s)
}

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

// attempt to run manually a tracer on a TraceResult data chunk.
// this is an inefficient version, since it requires full trace dump (can easily be 10Mb) to be returned
// from node, and processed locally.
// needed only for testing using local hardhat, which doesn't support javascript "tracer"
//   (which is annoying, since it IS a javascript evm...)
// INCOMPLETE: can't easily emulate "contract" methods (e.g. getAddress) without full emulating full CALL/RETURN/REVERT state
function applyTracer (tx: Transaction, res: TraceResult, options: TraceOptions): TraceResult | any {
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
        return currentLogEntry.memory!.length
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
      }
      case 'RETURN':
      case 'REVERT': {
        callstack.pop()
      }
    }
    if (callstack.depth() != depth && tracer.enter != null) {
      tracer.enter(callstack.top())
    }
    if (tracer.step != null) {
      tracer.step(step, NONE)
    }
  })

  return tracer.result(NONE, NONE)
}

// the trace options param for debug_traceCall and debug_traceTransaction
export interface TraceOptions {
  disableStorage?: boolean // Setting this to true will disable storage capture (default = false).
  disableStack?: boolean // Setting this to true will disable stack capture (default = false).
  enableMemory?: boolean // Setting this to true will enable memory capture (default = false).
  enableReturnData?: boolean // Setting this to true will enable return data capture (default = false).
  tracer?: LogTracerFunc | string // Setting this will enable JavaScript-based transaction tracing, described below. If set, the previous four arguments will be ignored.
  timeout?: string // Overrides the default timeout of 5 seconds for JavaScript-based tracing calls. Valid time units are "ns", "us" (or "µs"), "ms", "s", "m", "h".
}

// the result type of debug_traceCall and debug_traceTransaction
export interface TraceResult {
  gas: number
  returnValue: string
  structLogs: [TraceResultEntry]
}

export interface TraceResultEntry {
  depth: number
  error: string
  gas: number
  gasCost: number
  memory?: [string]
  op: string
  pc: number
  stack: [string]
  storage?: [string]
}

export interface LogContext {
  type: string // one of the two values CALL and CREATE
  from: string // Address, sender of the transaction
  to: string // Address, target of the transaction
  input: Buffer // Buffer, input transaction data
  gas: number // Number, gas budget of the transaction
  gasUsed: number //  Number, amount of gas used in executing the transaction (excludes txdata costs)
  gasPrice: number // Number, gas price configured in the transaction being executed
  intrinsicGas: number // Number, intrinsic gas for the transaction being executed
  value: BigNumber // big.Int, amount to be transferred in wei
  block: number // Number, block number
  output: Buffer // Buffer, value returned from EVM
  time: string // String, execution runtime

  // And these fields are only available for tracing mined transactions (i.e. not available when doing debug_traceCall):
  blockHash?: Buffer // - Buffer, hash of the block that holds the transaction being executed
  txIndex?: number // - Number, index of the transaction being executed in the block
  txHash?: Buffer // - Buffer, hash of the transaction being executed
}

export interface LogTracer {
  // mandatory: result, fault
  // result is a function that takes two arguments ctx and db, and is expected to return
  // a JSON-serializable value to return to the RPC caller.
  result: (ctx: LogContext, db: LogDb) => any

  // fault is a function that takes two arguments, log and db, just like step and is
  // invoked when an error happens during the execution of an opcode which wasn’t reported in step. The method log.getError() has information about the error.
  fault: (log: LogStep, db: LogDb) => void

  // optional (config is geth-level "cfg")
  setup?: (config: any) => any

  // optional
  step?: (log: LogStep, db: LogDb) => any

  // enter and exit must be present or omitted together.
  enter?: (frame: LogCallFrame) => void

  exit?: (frame: LogFrameResult) => void
}

export class LogCallFrame {
  constructor (readonly type: string,
    readonly caller: string,
    readonly address: string,
    readonly value: BigNumber,
    readonly input: string,
    readonly gas: BigNumber
  ) {
  }

  getType (): string {
    return this.type
  } // - returns a string which has the type of the call frame

  getFrom (): string {
    return this.caller
  } // - returns the address of the call frame sender

  getTo (): string {
    return this.address
  }// - returns the address of the call frame target

  getInput (): string {
    return this.input
  } // - returns the input as a buffer

  getGas (): BigNumber {
    return this.gas
  } // - returns a Number which has the amount of gas provided for the frame

  getValue (): BigNumber {
    return this.value
  } // - returns a big.Int with the amount to be transferred only if available, otherwise undefined
}

export interface LogFrameResult {
  getGasUsed: () => number // - returns amount of gas used throughout the frame as a Number
  getOutput: () => Buffer // - returns the output as a buffer
  getError: () => Buffer // - returns an error if one occured during execution and undefined` otherwise
}

export interface LogOpCode {
  isPush: () => boolean // returns true if the opcode is a PUSHn
  toString: () => string // returns the string representation of the opcode
  toNumber: () => number // returns the opcode’s number
}

export interface LogMemory {
  slice: (start: number, stop: number) => any // returns the specified segment of memory as a byte slice
  getUint: (offset: number) => any // returns the 32 bytes at the given offset
  length: () => number // returns the memory size
}

export interface LogStack {
  peek: (idx: number) => any // returns the idx-th element from the top of the stack (0 is the topmost element) as a big.Int
  length: () => number // returns the number of elements in the stack
}

export interface LogContract {
  getCaller: () => any // returns the address of the caller
  getAddress: () => string // returns the address of the current contract
  getValue: () => BigNumber // returns the amount of value sent from caller to contract as a big.Int
  getInput: () => any // returns the input data passed to the contract
}

export interface LogStep {
  op: LogOpCode // Object, an OpCode object representing the current opcode
  stack: LogStack // Object, a structure representing the EVM execution stack
  memory: LogMemory // Object, a structure representing the contract’s memory space
  contract: LogContract // Object, an object representing the account executing the current operation

  getPC: () => number // returns a Number with the current program counter
  getGas: () => number // returns a Number with the amount of gas remaining
  getCost: () => number // returns the cost of the opcode as a Number
  getDepth: () => number // returns the execution depth as a Number
  getRefund: () => number // returns the amount to be refunded as a Number
  getError: () => any //  returns information about the error if one occured, otherwise returns undefined
  // If error is non-empty, all other fields should be ignored.
}

export interface LogDb {
  getBalance: (address: string) => BigNumber // - returns a big.Int with the specified account’s balance
  getNonce: (address: string) => number // returns a Number with the specified account’s nonce
  getCode: (address: string) => any // returns a byte slice with the code for the specified account
  getState: (address: string, hash: string) => any // returns the state value for the specified account and the specified hash
  exists: (address: string) => boolean // returns true if the specified address exists
}
