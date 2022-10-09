import { BigNumber, BigNumberish } from 'ethers'
import {
  SimpleWallet,
  SimpleWallet__factory, SimpleWalletDeployer,
  SimpleWalletDeployer__factory
} from '@account-abstraction/contracts'

import { arrayify, hexConcat, keccak256 } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'
import { BaseApiParams, BaseWalletAPI } from './BaseWalletAPI'

/**
 * constructor params, added no top of base params:
 * @param owner the signer object for the wallet owner
 * @param factoryAddress address of contract "factory" to deploy new contracts (not needed if wallet already deployed)
 * @param index nonce value used when creating multiple wallets for the same owner
 */
export interface SimpleWalletApiParams extends BaseApiParams {
  owner: Signer
  factoryAddress?: string
  index?: number

}

/**
 * An implementation of the BaseWalletAPI using the SimpleWallet contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class SimpleWalletAPI extends BaseWalletAPI {
  factoryAddress?: string
  owner: Signer
  index: number

  /**
   * our wallet contract.
   * should support the "execFromEntryPoint" and "nonce" methods
   */
  walletContract?: SimpleWallet

  factory?: SimpleWalletDeployer

  constructor (params: SimpleWalletApiParams) {
    super(params)
    this.factoryAddress = params.factoryAddress
    this.owner = params.owner
    this.index = params.index ?? 0
  }

  async _getWalletContract (): Promise<SimpleWallet> {
    if (this.walletContract == null) {
      this.walletContract = SimpleWallet__factory.connect(await this.getWalletAddress(), this.provider)
    }
    return this.walletContract
  }

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's information
   */
  async getWalletInitCode (): Promise<string> {
    if (this.factory == null) {
      if (this.factoryAddress != null && this.factoryAddress !== '') {
        this.factory = SimpleWalletDeployer__factory.connect(this.factoryAddress, this.provider)
      } else {
        throw new Error('no factory to get initCode')
      }
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData('deployWallet', [this.entryPointAddress, await this.owner.getAddress(), this.index])
    ])
  }

  async getNonce (): Promise<BigNumber> {
    if (await this.checkWalletPhantom()) {
      return BigNumber.from(0)
    }
    const walletContract = await this._getWalletContract()
    return await walletContract.nonce()
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  async encodeExecute (target: string, value: BigNumberish, data: string): Promise<string> {
    const walletContract = await this._getWalletContract()
    return walletContract.interface.encodeFunctionData(
      'execFromEntryPoint',
      [
        target,
        value,
        data
      ])
  }

  async signRequestId (requestId: string): Promise<string> {
    return await this.owner.signMessage(arrayify(requestId))
  }

  /**
   * calculate the wallet address even before it is deployed.
   * We know our factory: it just calls CREATE2 to construct the wallet.
   * NOTE: getWalletAddress works with any contract/factory (but only before creation)
   * This method is tied to SimpleWallet implementation
   */
  async getCreate2Address (): Promise<string> {
    if (this.factoryAddress == null) {
      throw new Error('can\'t calculate address: no factory')
    }

    const ctrWithParams = new SimpleWallet__factory(undefined).getDeployTransaction(this.entryPointAddress, await this.owner.getAddress()).data as any
    const salt = '0x' + this.index.toString(16).padStart(64, '0')
    const hash = keccak256(hexConcat([
      '0xff', this.factoryAddress, salt, keccak256(ctrWithParams)
    ]))
    // hash is 32bytes, or 66 chars.
    // address is last 40 chars, with '0x' prefix
    return '0x' + hash.substring(66 - 40)
  }
}
