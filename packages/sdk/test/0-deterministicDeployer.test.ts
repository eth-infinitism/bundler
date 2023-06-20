import { expect } from 'chai'
import { ethers } from 'hardhat'
import { DeterministicDeployer } from '../src'
import { JsonRpcProvider, Provider } from 'ethers'
import { SampleRecipient__factory } from '@account-abstraction/utils'

const deployer = new DeterministicDeployer(ethers.provider as Provider as JsonRpcProvider)

describe('#deterministicDeployer', () => {
  it('deploy deployer', async () => {
    expect(await deployer.isDeployerDeployed()).to.equal(false)
    await deployer.deployFactory()
    expect(await deployer.isDeployerDeployed()).to.equal(true)
  })
  it('should ignore deploy again of deployer', async () => {
    await deployer.deployFactory()
  })
  it('should deploy at given address', async () => {
    const ctr = (await new SampleRecipient__factory(await ethers.provider.getSigner()).getDeployTransaction()).data
    DeterministicDeployer.init(ethers.provider as Provider as JsonRpcProvider)
    const addr = await DeterministicDeployer.getAddress(ctr)
    expect(await deployer.isContractDeployed(addr)).to.equal(false)
    await DeterministicDeployer.deploy(ctr)
    expect(await deployer.isContractDeployed(addr)).to.equal(true)
  })
})
