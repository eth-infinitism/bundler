import { ethers, BigNumber, BytesLike } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'
import { EntryPoint, SimpleWallet, SimpleWallet__factory } from '@erc4337/common/dist/src/types'

import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'

/**
 * Base class for all Smart Wallet ERC-4337 Clients to implement.
 */
export class SimpleWalletAPI {
  readonly simpleWalletFactory: SimpleWallet__factory
  private isPhantom: boolean = true
  private senderAddress!: string

  constructor (
    protected simpleWallet: SimpleWallet,
    readonly entryPoint: EntryPoint,
    readonly originalProvider: BaseProvider,
    readonly ownerAddress: string,
    readonly index = 0
  ) {
    this.simpleWalletFactory = new SimpleWallet__factory()
  }

  async init (): Promise<this> {
    const initCode = await this._getWalletInitCode()
    this.senderAddress = await this.entryPoint.getSenderAddress(initCode, this.index)
    const senderAddressCode = await this.originalProvider.getCode(this.senderAddress)
    if (senderAddressCode.length > 2) {
      console.log(`SimpleWallet Contract already deployed at ${this.senderAddress}`)
      this.isPhantom = false
      this.simpleWallet = this.simpleWallet.attach(this.senderAddress).connect(this.originalProvider)
    } else {
      console.log(`SimpleWallet Contract is NOT YET deployed at ${this.senderAddress} - working in "phantom wallet" mode.`)
    }
    return this
  }

  // TODO: support transitioning from 'phantom wallet' to 'deployed wallet' states
  async onWalletDeployed (): Promise<void> {
    throw new Error('not implemented')
  }

  async _getWalletInitCode (): Promise<BytesLike> {
    const deployTransactionData = this.simpleWalletFactory.getDeployTransaction(this.entryPoint.address, this.ownerAddress).data
    if (deployTransactionData == null) {
      throw new Error('Failed to create initCode')
    }
    return deployTransactionData
  }

  async getInitCode (): Promise<BytesLike> {
    if (this.isPhantom) {
      return await this._getWalletInitCode()
    }
    return '0x'
  }

  async getNonce (): Promise<BigNumber> {
    if (this.simpleWallet.address === ethers.constants.AddressZero) {
      return BigNumber.from(this.index)
    }
    return await this.simpleWallet.nonce()
  }

  async getVerificationGas (): Promise<number> {
    return 1000000
  }

  async getPreVerificationGas (): Promise<number> {
    // return 21000
    return 0
  }

  /**
   * TBD: We are assuming there is only the Wallet that impacts the resulting CallData here.
   */
  async encodeUserOpCallData (detailsForUserOp: TransactionDetailsForUserOp): Promise<string> {
    let value = BigNumber.from(0)
    if (detailsForUserOp.value !== '') {
      value = BigNumber.from(detailsForUserOp.value)
    }
    return this.simpleWallet.interface.encodeFunctionData(
      'execFromEntryPoint',
      [
        detailsForUserOp.target,
        value,
        detailsForUserOp.data
      ])
  }

  async getSender (): Promise<string> {
    return this.senderAddress
  }

  // tbd: not sure this is only dependant on Wallet, but callGas is the gas given to the Wallet, not just target
  async getCallGas (): Promise<number> {
    return 1000000
  }
}
