import { BigNumber, BigNumberish } from 'ethers'
import { hexConcat, hexlify, hexZeroPad, keccak256 } from 'ethers/lib/utils'
import { TransactionRequest } from '@ethersproject/abstract-provider'
import { JsonRpcProvider } from '@ethersproject/providers'

/**
 * wrapper class for Arachnid's deterministic deployer
 * (deterministic deployer used by 'hardhat-deployer'. generates the same addresses as "hardhat-deploy")
 */
export class DeterministicDeployer {
  /**
   * return the address this code will get deployed to.
   * @param ctrCode constructor code to pass to CREATE2
   * @param salt optional salt. defaults to zero
   */
  static async getAddress (ctrCode: string, salt: BigNumberish = 0): Promise<string> {
    return await DeterministicDeployer.instance.getDeterministicDeployAddress(ctrCode, salt)
  }

  /**
   * deploy the contract, unless already deployed
   * @param ctrCode constructor code to pass to CREATE2
   * @param salt optional salt. defaults to zero
   * @return the deployed address
   */
  static async deploy (ctrCode: string, salt: BigNumberish = 0): Promise<string> {
    return await DeterministicDeployer.instance.deterministicDeploy(ctrCode, salt)
  }

  // from: https://github.com/Arachnid/deterministic-deployment-proxy
  proxyAddress = '0x4e59b44847b379578588920ca78fbf26c0b4956c'
  deploymentTransaction = '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222'
  deploymentSignerAddress = '0x3fab184622dc19b6109349b94811493bf2a45362'
  deploymentGasPrice = 100e9
  deploymentGasLimit = 100000

  constructor (readonly provider: JsonRpcProvider) {
  }

  async isContractDeployed (address: string): Promise<boolean> {
    return await this.provider.getCode(address).then(code => code.length > 2)
  }

  async isDeployerDeployed (): Promise<boolean> {
    return await this.isContractDeployed(this.proxyAddress)
  }

  async deployDeployer (): Promise<void> {
    if (await this.isContractDeployed(this.proxyAddress)) {
      return
    }
    const bal = await this.provider.getBalance(this.deploymentSignerAddress)
    const neededBalance = BigNumber.from(this.deploymentGasLimit).mul(this.deploymentGasPrice)
    const signer = this.provider.getSigner()
    if (bal.lt(neededBalance)) {
      await signer.sendTransaction({
        to: this.deploymentSignerAddress,
        value: neededBalance,
        gasLimit: this.deploymentGasLimit
      })
    }
    await this.provider.send('eth_sendRawTransaction', [this.deploymentTransaction])
    if (!await this.isContractDeployed(this.proxyAddress)) {
      throw new Error('raw TX didn\'t deploy deployer!')
    }
  }

  async getDeployTransaction (ctrCode: string, salt: BigNumberish = 0): Promise<TransactionRequest> {
    await this.deployDeployer()
    const saltEncoded = hexZeroPad(hexlify(salt), 32)
    return {
      to: this.proxyAddress,
      data: hexConcat([
        saltEncoded,
        ctrCode])
    }
  }

  async getDeterministicDeployAddress (ctrCode: string, salt: BigNumberish = 0): Promise<string> {
    // this method works only before the contract is already deployed:
    // return await this.provider.call(await this.getDeployTransaction(ctrCode, salt))
    const saltEncoded = hexZeroPad(hexlify(salt), 32)

    return '0x' + keccak256(hexConcat([
      '0xff',
      this.proxyAddress,
      saltEncoded,
      keccak256(ctrCode)
    ])).slice(-40)
  }

  async deterministicDeploy (ctrCode: string, salt: BigNumberish = 0): Promise<string> {
    const addr = await this.getDeterministicDeployAddress(ctrCode, salt)
    if (!await this.isContractDeployed(addr)) {
      await this.provider.getSigner().sendTransaction(
        await this.getDeployTransaction(ctrCode, salt))
    }
    return addr
  }

  private static _instance?: DeterministicDeployer

  static init (provider: JsonRpcProvider): void {
    this._instance = new DeterministicDeployer(provider)
  }

  static get instance (): DeterministicDeployer {
    if (this._instance == null) {
      throw new Error('must call "DeterministicDeployer.init(ethers.provider)" first')
    }
    return this._instance
  }
}
