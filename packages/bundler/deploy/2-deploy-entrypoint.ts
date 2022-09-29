import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const UNSTAKE_DELAY_SEC = 100
const PAYMASTER_STAKE = ethers.utils.parseEther('1')

// deploy entrypoint - but only on debug network..
const deployEP: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // first verify if already deployed:
  try {
    await hre.deployments.deploy(
      'EntryPoint', {
        from: ethers.constants.AddressZero,
        args: [PAYMASTER_STAKE, UNSTAKE_DELAY_SEC],
        deterministicDeployment: true,
        log: true
      })

    // already deployed. do nothing.
    return
  } catch (e) {
  }

  const net = await hre.ethers.provider.getNetwork()
  if (net.chainId !== 1337 && net.chainId !== 31337) {
    console.log('NOT deploying EntryPoint. use pre-deployed entrypoint')
    return
  }

  const accounts = await hre.ethers.provider.listAccounts()
  const deployer = accounts[0]

  await hre.deployments.deploy(
    'EntryPoint', {
      // from: ethers.constants.AddressZero,
      from: deployer,
      args: [PAYMASTER_STAKE, UNSTAKE_DELAY_SEC],
      gasLimit: 4e6,
      deterministicDeployment: true,
      log: true
    })
}

export default deployEP
