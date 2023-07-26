import { JsonRpcProvider } from '@ethersproject/providers'
import { BigNumberish } from 'ethers/lib/ethers'
import { BigNumber } from 'ethers'
import { debug_traceCall } from './GethTracer'
import { bundlerCollectorTracer } from './BundlerCollectorTracer'
import { AddressZero } from '@account-abstraction/utils'

export class RpcError extends Error {
  // error codes from: https://eips.ethereum.org/EIPS/eip-1474
  constructor (msg: string, readonly code?: number, readonly data: any = undefined) {
    super(msg)
  }
}

export function tostr (s: BigNumberish): string {
  return BigNumber.from(s).toString()
}

export function requireCond (cond: boolean, msg: string, code?: number, data: any = undefined): void {
  if (!cond) {
    throw new RpcError(msg, code, data)
  }
}

/**
 * create a dictionary object with given keys
 * @param keys the property names of the returned object
 * @param mapper mapper from key to property value
 * @param filter if exists, must return true to add keys
 */
export function mapOf<T> (keys: Iterable<string>, mapper: (key: string) => T, filter?: (key: string) => boolean): {
  [key: string]: T
} {
  const ret: { [key: string]: T } = {}
  for (const key of keys) {
    if (filter == null || filter(key)) {
      ret[key] = mapper(key)
    }
  }
  return ret
}

export async function sleep (sleepTime: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, sleepTime))
}

export async function waitFor<T> (func: () => T | undefined, timeout = 10000, interval = 500): Promise<T> {
  const endTime = Date.now() + timeout
  while (true) {
    const ret = await func()
    if (ret != null) {
      return ret
    }
    if (Date.now() > endTime) {
      throw new Error(`Timed out waiting for ${func as unknown as string}`)
    }
    await sleep(interval)
  }
}

export async function supportsRpcMethod (provider: JsonRpcProvider, method: string, params: any[]): Promise<boolean> {
  const ret = await provider.send(method, params).catch(e => e)
  const code = ret.error?.code ?? ret.code
  return code === -32602 // wrong params (meaning, method exists)
}

export async function supportsDebugTraceCall (provider: JsonRpcProvider): Promise<boolean> {
  const p = provider.send as any
  if (p._clientVersion == null) {
    p._clientVersion = await provider.send('web3_clientVersion', [])
  }

  // make sure we can trace a call.
  const ret = await debug_traceCall(provider,
    { from: AddressZero, to: AddressZero, data: '0x' },
    { tracer: bundlerCollectorTracer }).catch(e => e)
  return ret.logs != null
  // debug('client version', p._clientVersion)
  // return p._clientVersion?.match('go1') != null
}
