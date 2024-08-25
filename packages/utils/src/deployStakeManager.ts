import { JsonRpcProvider } from '@ethersproject/providers'

import { bytecode as stakeManagerByteCode } from '../artifacts/@account-abstraction/rip7560/contracts/predeploys/StakeManager.sol/StakeManager.json'
import { DeterministicDeployer } from './DeterministicDeployer'
import { StakeManager__factory } from './types/factories/@account-abstraction/rip7560/contracts/predeploys'
import { StakeManager } from './types/@account-abstraction/rip7560/contracts/predeploys'

export const stakeManagerSalt = '0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3'

export async function deployStakeManager (provider: JsonRpcProvider, signer = provider.getSigner()): Promise<StakeManager> {
  const addr = await new DeterministicDeployer(provider, signer).deterministicDeploy(stakeManagerByteCode, stakeManagerSalt)
  return StakeManager__factory.connect(addr, signer)
}

export function getStakeManagerAddress (): string {
  return DeterministicDeployer.getAddress(stakeManagerByteCode, stakeManagerSalt)
}
