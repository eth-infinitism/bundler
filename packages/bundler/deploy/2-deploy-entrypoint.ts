import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import { deployEntryPoint, getEntryPointAddress } from '@account-abstraction/utils'

// deploy entrypoint - but only on debug network..
const deployEP: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const epAddr = getEntryPointAddress()
  if (await ethers.provider.getCode(epAddr) !== '0x') {
    console.log('EntryPoint already deployed at', epAddr)
    return
  }

  const net = await ethers.provider.getNetwork()
  if (net.chainId !== 1337 && net.chainId !== 31337) {
    console.log('NOT deploying EntryPoint. use pre-deployed entrypoint')
    process.exit(1)
  }

  await deployEntryPoint(ethers.provider)
  console.log('Deployed EntryPoint at', epAddr)
}

export default deployEP
