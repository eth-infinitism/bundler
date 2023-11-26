import { JsonRpcProvider } from "@ethersproject/providers";

import {
  AddressZero,
  IEntryPoint__factory,
  UserOperation,
} from "@epoch-protocol/utils";

import { bundlerCollectorTracer } from "./BundlerCollectorTracer";
import { debug_traceCall } from "./GethTracer";
import { ValidateUserOpResult, ValidationManager } from "./ValidationManager";

export * from "./ValidationManager";

export async function supportsDebugTraceCall(
  provider: JsonRpcProvider
): Promise<boolean> {
  const p = provider.send as any;
  if (p._clientVersion == null) {
    p._clientVersion = await provider.send("web3_clientVersion", []);
  }

  // make sure we can trace a call.
  const ret = await debug_traceCall(
    provider,
    { from: AddressZero, to: AddressZero, data: "0x" },
    { tracer: bundlerCollectorTracer }
  ).catch((e) => e);
  return ret.logs != null;
}

export async function checkRulesViolations(
  provider: JsonRpcProvider,
  userOperation: UserOperation,
  entryPointAddress: string
): Promise<ValidateUserOpResult> {
  const supportsTrace = await supportsDebugTraceCall(provider);
  if (!supportsTrace) {
    throw new Error("This provider does not support stack tracing");
  }
  const entryPoint = IEntryPoint__factory.connect(entryPointAddress, provider);
  const validationManager = new ValidationManager(entryPoint, false);
  return await validationManager.validateUserOp(userOperation);
}
