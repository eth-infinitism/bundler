import { Deferrable, defineReadOnly } from '@ethersproject/properties'
import { Provider, TransactionRequest, TransactionResponse } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { Bytes } from 'ethers'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { getRequestIdForSigning } from '@erc4337/common/src/ERC4337Utils'
import { UserOperation } from '@erc4337/common/src/UserOperation'
import { ClientConfig } from './ClientConfig'
import { HttpRpcClient } from './HttpRpcClient'

export class ERC4337EthersSigner extends Signer {
  // TODO: we have 'erc4337provider', remove shared dependencies or avoid two-way reference
  constructor (
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider,
    readonly httpRpcClient: HttpRpcClient
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
    const transactionResponse = await this.erc4337provider.constructUserOpTransactionResponse(userOperation)
    try {
      const bundlerResponse = await this.httpRpcClient.sendUserOpToBundler(userOperation)
      console.log('Bundler response:', bundlerResponse)
    } catch (error: any) {
      console.error('sendUserOpToBundler failed')
      throw this.unwrapError(error)
    }
    // TODO: handle errors - transaction that is "rejected" by bundler is _not likely_ to ever resolve its "wait()"
    return transactionResponse
  }

  unwrapError (errorIn: any): Error {
    if (errorIn.body != null) {
      const errorBody = JSON.parse(errorIn.body)
      let paymaster: string = ''
      let failedOpMessage: string | undefined = errorBody?.error?.message
      if (failedOpMessage?.includes('FailedOp') === true) {
        // TODO: better error extraction methods will be needed
        const matched = failedOpMessage.match(/FailedOp\((.*)\)/)
        if (matched != null) {
          const split = matched[1].split(',')
          paymaster = split[1]
          failedOpMessage = split[2]
        }
      }
      const error = new Error(`The bundler has failed to include UserOperation in a batch: ${failedOpMessage} (paymaster address: ${paymaster})`)
      error.stack = errorIn.stack
      return error
    }
    return errorIn
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
    return await this.erc4337provider.getSenderWalletAddress()
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
