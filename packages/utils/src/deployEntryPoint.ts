import { JsonRpcProvider } from '@ethersproject/providers'
import { bytecode as entryPointByteCode } from '@account-abstraction/contracts/artifacts/EntryPoint.json'
import { IEntryPoint, IEntryPoint__factory } from './soltypes'
import { DeterministicDeployer } from './DeterministicDeployer'

export const entryPointSalt = '0x0a59dbff790c23c976a548690c27297883cc66b4c67024f9117b0238995e35e9'

export async function deployEntryPoint (provider: JsonRpcProvider, signer = provider.getSigner()): Promise<IEntryPoint> {
  const addr = await new DeterministicDeployer(provider, signer).deterministicDeploy(entryPointByteCode, entryPointSalt)
  return IEntryPoint__factory.connect(addr, signer)
}

export function getEntryPointAddress (): string {
  return DeterministicDeployer.getAddress(entryPointByteCode, entryPointSalt)
}
