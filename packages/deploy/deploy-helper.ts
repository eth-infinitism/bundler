import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deploy} = hre.deployments;
  const [deployer] = await hre.ethers.provider.listAccounts()
  if ( !deployer) {
    throw new Error( "no deployer. missing MNEMONIC_FILE ?")
  }
  await deploy('BundlerHelper', {
    from: deployer,
    args: [],
    log: true,
    deterministicDeployment: true
  });
}
export default func;
