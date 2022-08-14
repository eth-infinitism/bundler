import { Deferrable, defineReadOnly } from '@ethersproject/properties'
import { Provider, TransactionRequest, TransactionResponse } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { Bytes } from 'ethers'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { getRequestIdForSigning } from '@erc4337/common/src/ERC4337Utils'
import { UserOperation } from '@erc4337/common/src/UserOperation'
import { ClientConfig } from './ClientConfig'

export class ERC4337EthersSigner extends Signer {
  constructor (
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider
  ) {
    super()
    defineReadOnly(this, 'provider', erc4337provider.originalProvider)
  }

  // This one is called by Contract. It signs the request and passes in to Provider to be sent.
  async sendTransaction (transaction: Deferrable<TransactionRequest>): Promise<TransactionResponse> {
    const tx: TransactionRequest = await this.populateTransaction(transaction)
    await this.verifyAllNecessaryFields(tx)
    const userOperation = await this.erc4337provider.createUserOp({
      target: tx.to ?? '',
      data: tx.data?.toString() ?? '',
      value: tx.value?.toString() ?? ''
    })
    userOperation.signature = await this.signUserOperation(userOperation)
    return await this.erc4337provider.constructUserOpTransactionResponse(userOperation)
  }

  async verifyAllNecessaryFields (transactionRequest: TransactionRequest): Promise<void> {
    if (transactionRequest.to == null) {
      throw new Error('Missing call target')
    }
    if (transactionRequest.data == null && transactionRequest.value == null) {
      // TBD: banning no-op UserOps seems to make sense on provider level
      throw new Error('Missing call data or value')
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

  async signUserOperation (userOperation: UserOperation): Promise<string> {
    const message = getRequestIdForSigning(userOperation, this.config.entryPointAddress, this.config.chainId)
    return await this.originalSigner.signMessage(message)
  }
}
