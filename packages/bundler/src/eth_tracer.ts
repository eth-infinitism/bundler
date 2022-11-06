import { Block, JsonRpcProvider, TransactionRequest } from '@ethersproject/providers'
import { Transaction } from 'ethers'
import { Deferrable } from '@ethersproject/properties'
//from:https://geth.ethereum.org/docs/rpc/ns-debug#javascript-based-tracing
//

export async function execAndTrace (provider: JsonRpcProvider, tx: Deferrable<TransactionRequest>, options: TraceOptions, forceGeth = false): Promise<TraceResult | any> {
  const hash = await provider.getSigner().sendUncheckedTransaction(tx)
  return await traceTransaction(provider, hash, options, forceGeth)
}

export async function traceTransaction (provider: JsonRpcProvider, hash: string, options: TraceOptions, forceGeth = false): Promise<TraceResult | any> {

  console.log('block=', await provider.getTransaction(hash).then(tx=>tx.blockNumber))
  console.log('send debug_traceTransactions', hash, options)
  const ret = await provider.send('debug_traceTransaction', [hash, options])
  console.log('debug trace ret=', ret)
  if (forceGeth) {
    return ret
  }
  return applyTracer(ret, options)
}

export async function traceCall (provider: JsonRpcProvider, tx: Deferrable<TransactionRequest>, options: TraceOptions): Promise<TraceResult | any> {

  console.log('==pretrace')
  const ret = await provider.send('debug_traceCall', [tx, options])
  console.log('posttrace')
  return applyTracer(ret, options)
}

function applyTracer (res: TraceResult, options: TraceOptions): TraceResult | any {
  //no tracer. leave unchanged.
  if (options.tracer == null) {
    return res
  }

  let tracer: LogTracer = {} as any
  console.log('opttracer=', options.tracer, typeof options.tracer)
  if (typeof options.tracer == 'object') {
    tracer = options.tracer
  } else {
    try {
      console.log('evaluating', options.tracer)
      eval('tracer=' + options.tracer)
      console.log('post-eval tracer=', tracer)

    } catch (e: any) {
      console.log('failed to parse: ', options.tracer)
      throw(e)
    }
  }
  const NONE = null as any
  // TODO: where we get config from? params?
  const config = NONE
  if (tracer.setup != null) {
    tracer.setup(config)
  }
  let logRes: TraceResultEntry = {} as any
  let step: LogStep = {
    op: {
      isPush (): boolean {
        return logRes.op.startsWith('PUSH')
      },
      toNumber (): number {
        throw new Error('unhandled')
      },
      toString (): string {
        return logRes.op
      }
    },
    memory: {
      slice (start: number, stop: number): any {
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
        const memorySlice = logRes.memory?.slice(istart, istop).join()
        // join memory slice
        return memorySlice?.slice(ioffset * 2, (stop - start) * 2)
      },
      getUint (offset: number): string {
        return logRes.memory?.[offset]!
      },
      length (): number {
        return logRes.memory!.length
      }
    },
    contract: {
      getInput (): any {
        throw new Error('unimpl')
      },
      getValue (): Bigint {
        throw new Error('unimpl')
      },
      getCaller (): any {
        throw new Error('unimpl')
      },
      getAddress (): string {
        throw new Error('unimpl')
      }
    },
    stack: {
      peek (idx: number): Bigint {
        return new Bigint('0x' + logRes.stack?.[logRes.stack?.length - idx - 1])
      },
      length (): number {
        return logRes.stack!.length
      }
    },
    getPC () {
      return logRes.pc
    },
    getGas (): number {
      return logRes.gas
    },
    getCost (): number {
      return logRes.gasCost
    },
    getDepth (): number {
      return logRes.depth
    },
    getRefund (): number {
      throw new Error('unhandled')
    },
    getError (): any {
      return undefined
    }
  }
  res.structLogs.forEach(log => {
    if (logRes.depth + 1 == log.depth && tracer.enter != null) {
      tracer.enter(NONE)
    }
    logRes = log
    if (tracer.step != null) {
      tracer.step(step, NONE)
    }
  })

  return tracer.result(NONE, NONE)
}

// Note that several values are Golang big.Int objects, not JavaScript numbers or JS bigints.
// As such, they have the same export interface as described in the godocs. Their default serialization to JSON is as a Javascript number; to serialize large numbers accurately call .String() on them
class Bigint {
  value: BigInt

  constructor (v: any) {
    this.value = BigInt(v)
  }

  String (): string {
    return this.value.toString()
  }

  toString (): string {
    return this.value.toString()
  }
}

// the trace options param for debug_traceCall and debug_traceTransaction
export interface TraceOptions {
  disableStorage?: boolean // Setting this to true will disable storage capture (default = false).
  disableStack?: boolean // Setting this to true will disable stack capture (default = false).
  enableMemory?: boolean // Setting this to true will enable memory capture (default = false).
  enableReturnData?: boolean // Setting this to true will enable return data capture (default = false).
  tracer?: LogTracer | string // Setting this will enable JavaScript-based transaction tracing, described below. If set, the previous four arguments will be ignored.
  timeout?: string // Overrides the default timeout of 5 seconds for JavaScript-based tracing calls. Valid time units are "ns", "us" (or "µs"), "ms", "s", "m", "h".
}

// the result type of debug_traceCall and debug_traceTransaction
export interface TraceResult {
  gas: number,
  returnValue: string,
  structLogs: [TraceResultEntry]
}

export interface TraceResultEntry {
  depth: number,
  error: string,
  gas: number,
  gasCost: number,
  memory?: [string],
  op: string,
  pc: number,
  stack?: [string],
  storage?: [string]
}

export interface LogContext {
  type: string // one of the two values CALL and CREATE
  from: string // Address, sender of the transaction
  to: string //Address, target of the transaction
  input: Buffer // Buffer, input transaction data
  gas: number // Number, gas budget of the transaction
  gasUsed: number //  Number, amount of gas used in executing the transaction (excludes txdata costs)
  gasPrice: number // Number, gas price configured in the transaction being executed
  intrinsicGas: number // Number, intrinsic gas for the transaction being executed
  value: Bigint //big.Int, amount to be transferred in wei
  block: number // Number, block number
  output: Buffer // Buffer, value returned from EVM
  time: string // String, execution runtime

  //And these fields are only available for tracing mined transactions (i.e. not available when doing debug_traceCall):
  blockHash?: Buffer // - Buffer, hash of the block that holds the transaction being executed
  txIndex?: number // - Number, index of the transaction being executed in the block
  txHash?: Buffer // - Buffer, hash of the transaction being executed
}

export interface LogTracer {
  //mandatory: result, fault
  //result is a function that takes two arguments ctx and db, and is expected to return
  // a JSON-serializable value to return to the RPC caller.
  result (ctx: LogContext, db: LogDb): any

  //fault is a function that takes two arguments, log and db, just like step and is
  // invoked when an error happens during the execution of an opcode which wasn’t reported in step. The method log.getError() has information about the error.
  fault (log: LogStep, db: LogDb): void

  //optional (config is geth-level "cfg")
  setup? (config: any): any

  //optional
  step? (log: LogStep, db: LogDb): any

  //enter and exit must be present or omitted together.
  enter? (frame: LogCallFrame): void

  exit? (frame: LogFrameResult): void
}

export interface LogCallFrame {
  getType (): string // - returns a string which has the type of the call frame
  getFrom (): string //- returns the address of the call frame sender
  getTo (): string // - returns the address of the call frame target
  getInput (): Buffer // - returns the input as a buffer
  getGas (): number // - returns a Number which has the amount of gas provided for the frame
  getValue (): Bigint // - returns a big.Int with the amount to be transferred only if available, otherwise undefined
}

export interface LogFrameResult {
  getGasUsed (): number // - returns amount of gas used throughout the frame as a Number
  getOutput (): Buffer // - returns the output as a buffer
  getError (): Buffer // - returns an error if one occured during execution and undefined` otherwise
}

export interface LogOpCode {
  isPush (): boolean // returns true if the opcode is a PUSHn
  toString (): string // returns the string representation of the opcode
  toNumber (): number // returns the opcode’s number
}

export interface LogMemory {
  slice (start: number, stop: number): any // returns the specified segment of memory as a byte slice
  getUint (offset: number): string // returns the 32 bytes at the given offset
  length (): number // returns the memory size
}

export interface LogStack {
  peek (idx: number): Bigint // returns the idx-th element from the top of the stack (0 is the topmost element) as a big.Int
  length (): number // returns the number of elements in the stack
}

export interface LogContract {
  getCaller (): any // returns the address of the caller
  getAddress (): string // returns the address of the current contract
  getValue (): Bigint // returns the amount of value sent from caller to contract as a big.Int
  getInput (): any // returns the input data passed to the contract
}

export interface LogStep {
  op: LogOpCode // Object, an OpCode object representing the current opcode
  stack: LogStack // Object, a structure representing the EVM execution stack
  memory: LogMemory // Object, a structure representing the contract’s memory space
  contract: LogContract // Object, an object representing the account executing the current operation

  getPC (): number // returns a Number with the current program counter
  getGas (): number // returns a Number with the amount of gas remaining
  getCost (): number // returns the cost of the opcode as a Number
  getDepth (): number // returns the execution depth as a Number
  getRefund (): number // returns the amount to be refunded as a Number
  getError (): any  //  returns information about the error if one occured, otherwise returns undefined
                    //If error is non-empty, all other fields should be ignored.
}

export interface LogDb {
  getBalance (address: string): Bigint // - returns a big.Int with the specified account’s balance
  getNonce (address: string): number // returns a Number with the specified account’s nonce
  getCode (address: string): any // returns a byte slice with the code for the specified account
  getState (address: string, hash: string): any // returns the state value for the specified account and the specified hash
  exists (address: string): boolean // returns true if the specified address exists
}

