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
    private url: ConnectionInfo | string,
    private originalSigner: Signer,
    private originalProvider: Provider,
    private bundlerUrl: string,
    private paymasterAPI: PaymasterAPI,
    private smartWalletAPI: SmartWalletAPI,
    private userOpAPI: UserOpAPI,
  ) {
    super(network)
    this.signer = new ERC4337EthersSigner(originalSigner, this)
  }

  getSigner (addressOrIndex?: string | number): ERC4337EthersSigner {
    return this.signer
  }

  perform (method: string, params: any): Promise<any> {
    if (method === 'eth_sendUserOperation') {

      return Promise.resolve()
    }
    if (method === 'sendTransaction') {
      throw new Error('Should not get here. Investigate.')
    }
    return super.perform(method, params)
  }

  sendTransaction (signedTransaction: string | Promise<string>): Promise<TransactionResponse> {
    return super.sendTransaction(signedTransaction)
  }

  getTransaction (transactionHash: string | Promise<string>): Promise<TransactionResponse> {
    return super.getTransaction(transactionHash)
  }

  getTransactionReceipt (transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
    return super.getTransactionReceipt(transactionHash)
  }
}
