import { ConnectionInfo } from '@ethersproject/web'
import { BaseProvider, Provider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers'
import { Networkish } from '@ethersproject/networks'

import { PaymasterAPI } from './PaymasterAPI'
import { SmartWalletAPI } from './SmartWalletAPI'
import { UserOpAPI } from './UserOpAPI'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { Signer } from 'ethers'

export class ERC4337EthersProvider extends BaseProvider {
  readonly isErc4337Provider = true
  readonly signer: ERC4337EthersSigner

  constructor (
    network: Networkish,
    private readonly url: ConnectionInfo | string,
    private readonly originalSigner: Signer,
    private readonly originalProvider: Provider,
    private readonly bundlerUrl: string,
    private readonly paymasterAPI: PaymasterAPI,
    private readonly smartWalletAPI: SmartWalletAPI,
    private readonly userOpAPI: UserOpAPI
  ) {
    super(network)
    this.signer = new ERC4337EthersSigner(originalSigner, this)
  }

  getSigner (addressOrIndex?: string | number): ERC4337EthersSigner {
    return this.signer
  }

  async perform (method: string, params: any): Promise<any> {
    if (method === 'eth_sendUserOperation') {
      return await Promise.resolve()
    }
    if (method === 'sendTransaction') {
      throw new Error('Should not get here. Investigate.')
    }
    return await super.perform(method, params)
  }

  async sendTransaction (signedTransaction: string | Promise<string>): Promise<TransactionResponse> {
    return await super.sendTransaction(signedTransaction)
  }

  async getTransaction (transactionHash: string | Promise<string>): Promise<TransactionResponse> {
    return await super.getTransaction(transactionHash)
  }

  async getTransactionReceipt (transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
    return await super.getTransactionReceipt(transactionHash)
  }
}
