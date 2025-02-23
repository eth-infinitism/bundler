import { JsonRpcProvider } from '@ethersproject/providers'

import { bytecode as stakeManagerByteCode } from '../artifacts/@account-abstraction/rip7560/contracts/predeploys/Rip7560StakeManager.sol/Rip7560StakeManager.json'
import { DeterministicDeployer } from './DeterministicDeployer'
import { Rip7560StakeManager__factory, Rip7560StakeManager } from './types'

export const stakeManagerSalt = '0x90d8084deab30c2a37c45e8d47f49f2f7965183cb6990a98943ef94940681de3'

export async function deployStakeManager (provider: JsonRpcProvider, signer = provider.getSigner()): Promise<Rip7560StakeManager> {
  const addr = await new DeterministicDeployer(provider, signer).deterministicDeploy(stakeManagerByteCode, stakeManagerSalt)
  console.log(`Deployed StakeManager contract at: ${addr}`)
  return Rip7560StakeManager__factory.connect(addr, signer)
}

export function getStakeManagerAddress (): string {
  return DeterministicDeployer.getAddress(stakeManagerByteCode, stakeManagerSalt)
}
