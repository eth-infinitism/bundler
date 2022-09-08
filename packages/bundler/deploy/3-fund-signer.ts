import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import { parseEther } from 'ethers/lib/utils'
import deployEP from './2-deploy-entrypoint'

// deploy entrypoint - but only on debug network..
const fundsigner: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {

  const { deploy } = hre.deployments

  //on geth, fund the default "hardhat node" account.

  const provider = hre.ethers.provider
  const signer = provider.getSigner()
  const signerBalance = await provider.getBalance(signer.getAddress())
  const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const bal = await provider.getBalance(account)
  if (bal.lt(parseEther('1')) && signerBalance.gte(parseEther('10000'))) {
    console.log('funding hardhat account', account)
    await signer.sendTransaction({
      to: account,
      value: parseEther('1').sub(bal)
    })
  }
}

export default fundsigner
