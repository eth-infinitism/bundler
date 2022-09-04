import { BigNumber, Contract, BigNumberish } from 'ethers'
import {
  EntryPoint,
  SimpleWallet__factory,
  SimpleWalletDeployer__factory
} from '@account-abstraction/contracts'

import { arrayify, hexConcat } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'
import { BaseWalletAPI } from './BaseWalletAPI'

/**
 * An implementation of the BaseWalletAPI using the SimpleWallet contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class SimpleWalletAPI extends BaseWalletAPI {
  /**
   * base constructor.
   * subclass SHOULD add parameters that define the owner (signer) of this wallet
   * @param entryPoint entrypoint to direct the requests through
   * @param walletAddress optional wallet address, if connecting to an existing contract.
   * @param owner the signer object for the wallet owner
   * @param factoryAddress address of contract "factory" to deploy new contracts
   * @param index nonce value used when creating multiple wallets for the same owner
   */
  constructor (
    entryPoint: EntryPoint,
    walletAddress: string | undefined,
    readonly owner: Signer,
    readonly factoryAddress?: string,
    // index is "salt" used to distinguish multiple wallets of the same signer.
    readonly index = 0
  ) {
    super(entryPoint, walletAddress)
  }

  /**
   * create the wallet contract object.
   * should support our "executeFromEntryPoint" and "nonce" methods
   */
  createWalletContract (address: string): Contract {
    return SimpleWallet__factory.connect(address, this.provider)
  }

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's infromation
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
      this.factory.interface.encodeFunctionData('deployWallet', [this.entryPoint.address, await this.owner.getAddress(), this.index])
    ])
  }

  async getNonce (): Promise<BigNumber> {
    if (await this.checkWalletPhantom()) {
      return BigNumber.from(0)
    }
    return this.walletContract.nonce()
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  encodeExecute (target: string, value: BigNumberish, data: string): string {
    return this.walletContract.interface.encodeFunctionData(
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
}
