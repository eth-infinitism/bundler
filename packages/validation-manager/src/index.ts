import { JsonRpcProvider } from '@ethersproject/providers'
import { debug_traceCall } from './GethTracer'
import { AddressZero } from '@account-abstraction/utils'
import { bundlerCollectorTracer } from './BundlerCollectorTracer'

export * from './ValidationManager'

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
}
