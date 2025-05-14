import { JsonRpcProvider } from '@ethersproject/providers'

import {
  AddressZero,
  IEntryPoint__factory,
  UserOperation
} from '@account-abstraction/utils'
import { PreVerificationGasCalculator } from '@account-abstraction/sdk'

import { bundlerJSTracerName, debug_traceCall, GethNativeTracerName } from './GethTracer'
import { ValidateUserOpResult } from './IValidationManager'
import { ValidationManager } from './ValidationManager'
import { ERC7562Parser } from './ERC7562Parser'

export * from './ERC7562Parser'
export * from './ValidationManager'
export * from './ValidationManagerRIP7560'
export * from './IValidationManager'
export * from './altmempool/AltMempoolConfig'
export * from './enum/ERC7562Rule'
export * from './enum/EVMOpcodes'

export async function supportsNativeTracer (provider: JsonRpcProvider, nativeTracer = bundlerJSTracerName): Promise<boolean> {
  try {
    await provider.send('debug_traceCall', [{}, 'latest', { tracer: nativeTracer }])
    return true
  } catch (e) {
    return false
  }
}

export async function supportsDebugTraceCall (provider: JsonRpcProvider, rip7560: boolean): Promise<boolean> {
  const p = provider.send as any
  if (p._clientVersion == null) {
    p._clientVersion = await provider.send('web3_clientVersion', [])
  }

  if (rip7560) {
    // no need to check for the internal RIP-7560 support
    return true
  }
  // make sure we can trace a call.
  const ret = await debug_traceCall(provider,
    { from: AddressZero, to: AddressZero, data: '0x' },
    { tracer: GethNativeTracerName }).catch(e => e)
  return ret.usedOpcodes != null
}

export async function checkRulesViolations (
  provider: JsonRpcProvider,
  userOperation: UserOperation,
  entryPointAddress: string
): Promise<ValidateUserOpResult> {
  const supportsTrace = await supportsDebugTraceCall(provider, false)
  if (!supportsTrace) {
    throw new Error('This provider does not support stack tracing')
  }
  const entryPoint = IEntryPoint__factory.connect(entryPointAddress, provider)
  const senderCreator = await entryPoint.senderCreator()
  const erc7562Parser = new ERC7562Parser(entryPointAddress, senderCreator)
  const validationManager = new ValidationManager(
    entryPoint,
    false,
    Object.assign({}) as PreVerificationGasCalculator,
    erc7562Parser
  )
  return await validationManager.validateUserOp(userOperation)
}
