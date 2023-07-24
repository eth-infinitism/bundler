import { BigNumber, BigNumberish, Contract } from 'ethers'
import {
  SmartWalletV3 as LoopringAccount,
  SmartWalletV3__factory as LoopringAccount__factory
} from './typechain'

import { arrayify } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'
import { BaseApiParams, BaseAccountAPI } from './BaseAccountAPI'

/**
 * constructor params, added no top of base params:
 * @param owner the signer object for the account owner
 * @param factoryAddress address of contract "factory" to deploy new contracts (not needed if account already deployed)
 * @param index nonce value used when creating multiple accounts for the same owner
 */
export interface SimpleAccountApiParams extends BaseApiParams {
  owner: Signer
  factoryAddress?: string
  index?: BigNumberish

}

/**
 * An implementation of the BaseAccountAPI using the SimpleAccount contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class LoopringAccountAPI extends BaseAccountAPI {
  factoryAddress?: string
  owner: Signer
  index: BigNumberish

  /**
   * our account contract.
   * should support the "execFromEntryPoint" and "nonce" methods
   */
  accountContract?: LoopringAccount

  factory?: Contract

  constructor (params: SimpleAccountApiParams) {
    super(params)
    this.factoryAddress = params.factoryAddress
    this.owner = params.owner
    this.index = BigNumber.from(params.index ?? 0)
  }

  async _getAccountContract (): Promise<Contract> {
    if (this.accountContract == null) {
      this.accountContract = LoopringAccount__factory.connect(await this.getAccountAddress(), this.provider)
    }
    return this.accountContract
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode (): Promise<string> {
    return '0x'
  }

  async getNonce (): Promise<BigNumber> {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0)
    }
    const accountContract = await this._getAccountContract()
    const nonce = await accountContract.nonce()
    return nonce.add(1)
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  async encodeExecute (target: string, value: BigNumberish, data: string): Promise<string> {
    const accountContract = await this._getAccountContract()
    if (target.toLowerCase() === accountContract.address.toLowerCase()) {
      return data
    }
    return accountContract.interface.encodeFunctionData(
      'callContract',
      [
        target,
        value,
        data,
        false
      ])
  }

  async signUserOpHash (userOpHash: string): Promise<string> {
    return await this.owner.signMessage(arrayify(userOpHash))
  }
}
