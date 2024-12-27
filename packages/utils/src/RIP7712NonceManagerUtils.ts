import { JsonRpcProvider } from '@ethersproject/providers'

import { bytecode as nonceManagerByteCode } from '../artifacts/@account-abstraction/rip7560/contracts/predeploys/NonceManager.sol/NonceManager.json'
import { DeterministicDeployer } from './DeterministicDeployer'
import { NonceManager__factory } from './types/factories/@account-abstraction/rip7560/contracts/predeploys'
import { NonceManager } from './types/@account-abstraction/rip7560/contracts/predeploys'

export const entryPointSalt = '0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3'

export async function deployNonceManager (provider: JsonRpcProvider, signer = provider.getSigner()): Promise<NonceManager> {
  const addr = await new DeterministicDeployer(provider, signer).deterministicDeploy(nonceManagerByteCode, entryPointSalt)
  console.log('Deployed NonceManager contract at: ', addr)
  return NonceManager__factory.connect(addr, signer)
}

export function getNonceManagerAddress (): string {
  return DeterministicDeployer.getAddress(nonceManagerByteCode, entryPointSalt)
}
