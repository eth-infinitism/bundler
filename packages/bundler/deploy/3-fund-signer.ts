import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import { parseEther } from 'ethers/lib/utils'
import deployEP from './2-deploy-entrypoint'

// deploy entrypoint - but only on debug network..
const fundsigner: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

  const { deploy } = hre.deployments

  //on geth, fund the default "hardhat node" account.

  let provider = hre.ethers.provider
  let signer = provider.getSigner()
  let bal = await provider.getBalance(signer.getAddress())
  if (bal.gte(parseEther('10000'))) {
    console.log('funding hardhat account')
    await signer.sendTransaction({
      to: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      value: parseEther('1')
    })
  }
}

export default fundsigner
