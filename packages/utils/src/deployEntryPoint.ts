import { JsonRpcProvider } from '@ethersproject/providers'
import { bytecode as entryPointByteCode } from '@account-abstraction/contracts/artifacts/EntryPoint.json'
import { IEntryPoint, IEntryPoint__factory } from './soltypes'
import { DeterministicDeployer } from './DeterministicDeployer'

export async function deployEntryPoint (provider: JsonRpcProvider, signer=provider.getSigner()): Promise<IEntryPoint> {
  const addr = await new DeterministicDeployer(provider, signer).deterministicDeploy(entryPointByteCode)
  return IEntryPoint__factory.connect(addr, provider)
}

export function getEntryPointAddress () {
  return DeterministicDeployer.getAddress(entryPointByteCode)
}
