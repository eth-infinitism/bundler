import { JsonRpcProvider } from '@ethersproject/providers'

import { AddressZero, IEntryPoint__factory, OperationRIP7560, UserOperation } from '@account-abstraction/utils'

import { bundlerCollectorTracer } from './BundlerCollectorTracer'
import { debug_traceCall, debug_traceRip7560Validation } from './GethTracer'
import { ValidateUserOpResult } from './IValidationManager'
import { ValidationManager } from './ValidationManager'

export * from './ValidationManager'
export * from './ValidationManagerRIP7560'
export * from './IValidationManager'

export async function supportsDebugTraceCall (provider: JsonRpcProvider, useRip7560Mode: boolean): Promise<boolean> {
  const p = provider.send as any
  if (p._clientVersion == null) {
    p._clientVersion = await provider.send('web3_clientVersion', [])
  }

  if (useRip7560Mode) {
    // TODO: remove
    const defaultsForRip7560Tx: OperationRIP7560 = {
      accessList: [],
      builderFee: '0x0',
      chainId: '0x539',
      value: '0x0',
      sender: AddressZero,
      nonce: '0x0',
      callData: '0x',
      callGasLimit: '0x0',
      verificationGasLimit: '0x10000',
      maxFeePerGas: '0x100000000',
      maxPriorityFeePerGas: '0x100000000',
      paymaster: AddressZero,
      paymasterData: '0x',
      factory: AddressZero,
      factoryData: '0x',
      paymasterVerificationGasLimit: '0x10000',
      paymasterPostOpGasLimit: '0x0',
      signature: '0x'
    };

    // TODO: align parameter names across 4337 and 7560
    (defaultsForRip7560Tx as any).deployer = defaultsForRip7560Tx.factory;
    (defaultsForRip7560Tx as any).deployerData = defaultsForRip7560Tx.factoryData
    // make sure we can trace a call.
    const ret = await debug_traceRip7560Validation(provider, defaultsForRip7560Tx
    ).catch(e => e)
    return ret.traceResults != null
  }
  // make sure we can trace a call.
  const ret = await debug_traceCall(provider,
    { from: AddressZero, to: AddressZero, data: '0x' },
    { tracer: bundlerCollectorTracer }).catch(e => e)
  return ret.logs != null
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
  const validationManager = new ValidationManager(
    entryPoint,
    false
  )
  return await validationManager.validateUserOp(userOperation)
}
