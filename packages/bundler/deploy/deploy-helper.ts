import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments
  const accounts = await hre.ethers.provider.listAccounts()
  console.log('Available accounts:', accounts)
  const deployer = accounts[0]
  console.log('Will deploy from account:', deployer)

  if (deployer == null) {
    throw new Error('no deployer. missing MNEMONIC_FILE ?')
  }
  await deploy('BundlerHelper', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true
  })
}

export default func
func.tags = ['BundlerHelper']
