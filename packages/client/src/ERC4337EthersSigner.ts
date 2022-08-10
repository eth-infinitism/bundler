import { Deferrable, defineReadOnly } from '@ethersproject/properties'
import { Provider, TransactionRequest, TransactionResponse } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { UserOperation } from '@erc4337/common/dist/src/UserOperation'

import { Bytes } from 'ethers'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'

export class ERC4337EthersSigner extends Signer {
  constructor (
    private readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider
  ) {
    super()
    defineReadOnly(this, 'provider', erc4337provider.originalProvider)
  }

  // This one is cvalled by Contract. It signs the request and passes in to Provider to be sent.
  async sendTransaction (transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
    // code from super;
    this._checkProvider('sendTransaction')
    const tx: TransactionRequest = await this.populateTransaction(transaction)
    const signedTx = await this.signTransaction(tx)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return await this.provider!.sendTransaction(signedTx)

    // must do:
    // 1. Turn 'Transaction Request' into partial user op
    // 2. get 'wallet api' to fill missing parts
    // 3. get 'paymaster api' to fill missing parts
    // 3. get 'userOp api' to fill missing parts
    // 3. send to
  }

  async convertToUserOperation (transactionRequest: TransactionRequest): Promise<Partial<UserOperation>> {
    if (transactionRequest.to == null) {
      throw new Error('Missing call target')
    }
    if (transactionRequest.data == null && transactionRequest.value == null) {
      // TBD: banning no-op UserOps seems to make sense on provider level
      throw new Error('Missing call data or value')
    }
    const callData = await this.erc4337provider.encodeUserOpCalldata({
      target: transactionRequest.to,
      data: transactionRequest.data,
      value: transactionRequest.value
    })
    return {
      callData
     }
  }

  connect (provider: Provider): Signer {
    throw new Error('changing providers is not supported')
  }

  async getAddress (): Promise<string> {
    return await this.originalSigner.getAddress()
  }

  async signMessage (message: Bytes | string): Promise<string> {
    return await this.originalSigner.signMessage(message)
  }

  async signTransaction (transaction: Deferrable<TransactionRequest>): Promise<string> {
    return await Promise.resolve('')
  }
}
