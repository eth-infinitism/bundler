import {
  BigNumberish, concat,
  ContractFactory,
  getBigInt,
  hexlify,
  JsonRpcProvider,
  JsonRpcSigner, keccak256, Provider,
  Signer, toBeHex,
  toQuantity,
  TransactionRequest, zeroPadBytes
} from 'ethers'

/**
 * wrapper class for Arachnid's deterministic deployer
 * (deterministic deployer used by 'hardhat-deployer'. generates the same addresses as "hardhat-deploy")
 */
export class DeterministicDeployer {
  /**
   * return the address this code will get deployed to.
   * @param ctrCode constructor code to pass to CREATE2, or ContractFactory
   * @param salt optional salt. defaults to zero
   */
  static async getAddress (ctrCode: string, salt: BigNumberish): Promise<string>
  static async getAddress (ctrCode: string): Promise<string>
  static async getAddress (ctrCode: ContractFactory, salt: BigNumberish, params: any[]): Promise<string>
  static async getAddress (ctrCode: string | ContractFactory, salt: BigNumberish = 0, params: any[] = []): Promise<string> {
    return await DeterministicDeployer.getDeterministicDeployAddress(ctrCode, salt, params)
  }

  /**
   * deploy the contract, unless already deployed
   * @param ctrCode constructor code to pass to CREATE2 or ContractFactory
   * @param salt optional salt. defaults to zero
   * @return the deployed address
   */
  static async deploy (ctrCode: string, salt: BigNumberish): Promise<string>
  static async deploy (ctrCode: string): Promise<string>
  static async deploy (ctrCode: ContractFactory, salt: BigNumberish, params: any[]): Promise<string>
  static async deploy (ctrCode: string | ContractFactory, salt: BigNumberish = 0, params: any[] = []): Promise<string> {
    return await DeterministicDeployer.instance.deterministicDeploy(ctrCode, salt, params)
  }

  // from: https://github.com/Arachnid/deterministic-deployment-proxy
  static proxyAddress = '0x4e59b44847b379578588920ca78fbf26c0b4956c'
  static deploymentTransaction = '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222'
  static deploymentSignerAddress = '0x3fab184622dc19b6109349b94811493bf2a45362'
  static deploymentGasPrice = 100e9
  static deploymentGasLimit = 100000

  private signer?: Signer

  constructor (
    readonly provider: Provider,
    readonly _signer?: Signer) {

    if (_signer == null) {
      (provider as JsonRpcProvider).getSigner().then(s => this.signer = s)
    } else {
      this.signer = _signer
    }
  }

  async isContractDeployed (address: string): Promise<boolean> {
    return await this.provider.getCode(address).then(code => code.length > 2)
  }

  async isDeployerDeployed (): Promise<boolean> {
    return await this.isContractDeployed(DeterministicDeployer.proxyAddress)
  }

  async deployFactory (): Promise<void> {
    if (await this.isContractDeployed(DeterministicDeployer.proxyAddress)) {
      return
    }
    const bal = await this.provider.getBalance(DeterministicDeployer.deploymentSignerAddress)
    const neededBalance = getBigInt(DeterministicDeployer.deploymentGasLimit) * getBigInt(DeterministicDeployer.deploymentGasPrice)
    if (bal < neededBalance) {
      const signer = this.signer ?? await (this.provider as JsonRpcProvider).getSigner()
      await signer.sendTransaction({
        to: DeterministicDeployer.deploymentSignerAddress,
        value: neededBalance,
        gasLimit: DeterministicDeployer.deploymentGasLimit
      })
    }
    await (this.provider as JsonRpcProvider).send('eth_sendRawTransaction', [DeterministicDeployer.deploymentTransaction])
    if (!await this.isContractDeployed(DeterministicDeployer.proxyAddress)) {
      throw new Error('raw TX didn\'t deploy deployer!')
    }
  }

  async getDeployTransaction (ctrCode: string | ContractFactory, salt: BigNumberish = 0, params: any[] = []): Promise<TransactionRequest> {
    await this.deployFactory()
    const saltEncoded = toBeHex(salt, 32)
    const ctrEncoded = await DeterministicDeployer.getCtrCode(ctrCode, params)
    return {
      to: DeterministicDeployer.proxyAddress,
      data: concat([
        saltEncoded,
        ctrEncoded])
    }
  }

  static async getCtrCode (ctrCode: string | ContractFactory, params: any[]): Promise<string> {
    if (typeof ctrCode !== 'string') {
      return hexlify(await ctrCode.getDeployTransaction(...params).then(x => x.data))
    } else {
      if (params.length !== 0) {
        throw new Error('constructor params can only be passed to ContractFactory')
      }
      return ctrCode
    }
  }

  static async getDeterministicDeployAddress (ctrCode: string | ContractFactory, salt: BigNumberish = 0, params: any[] = []): Promise<string> {
    // this method works only before the contract is already deployed:
    // return await this.provider.call(await this.getDeployTransaction(ctrCode, salt))
    const saltEncoded = toBeHex(salt, 32)

    const ctrCode1 = await DeterministicDeployer.getCtrCode(ctrCode, params)
    return '0x' + keccak256(concat([
      '0xff',
      DeterministicDeployer.proxyAddress,
      saltEncoded,
      keccak256(ctrCode1)
    ])).slice(-40)
  }

  async deterministicDeploy (ctrCode: string | ContractFactory, salt: BigNumberish = 0, params: any[] = []): Promise<string> {
    const addr = await DeterministicDeployer.getDeterministicDeployAddress(ctrCode, salt, params)
    if (!await this.isContractDeployed(addr)) {
      await this.signer!.sendTransaction(
        await this.getDeployTransaction(ctrCode, salt, params))
    }
    return addr
  }

  private static _instance?: DeterministicDeployer

  static init (provider: Provider, signer?: JsonRpcSigner): void {
    this._instance = new DeterministicDeployer(provider as JsonRpcProvider, signer)
  }

  static get instance (): DeterministicDeployer {
    if (this._instance == null) {
      throw new Error('must call "DeterministicDeployer.init(ethers.provider)" first')
    }
    return this._instance
  }
}
