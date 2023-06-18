import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { parseEther } from 'ethers'

const fundsigner: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // on geth, fund the default "hardhat node" account.

  const provider = hre.ethers.provider
  const signer = await provider.getSigner()
  const signerBalance = await provider.getBalance(signer.getAddress())
  const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const bal = await provider.getBalance(account)
  if (bal < parseEther('1') && signerBalance >= parseEther('10000')) {
    console.log('funding hardhat account', account)
    await signer.sendTransaction({
      to: account,
      value: parseEther('1') - bal
    })
  }
}

export default fundsigner
