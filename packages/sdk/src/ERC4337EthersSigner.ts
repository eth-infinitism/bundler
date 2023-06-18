
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { ClientConfig } from './ClientConfig'
import { HttpRpcClient } from './HttpRpcClient'
import { UserOperationStruct } from '@account-abstraction/utils/src/types/@account-abstraction/contracts/core/EntryPoint'
import { BaseAccountAPI } from './BaseAccountAPI'
import { JsonRpcSigner, Provider, Signer, TransactionRequest, TransactionResponse } from 'ethers'

const debug = require('debug')('aa.signer')
export class ERC4337EthersSigner extends JsonRpcSigner {
  // TODO: we have 'erc4337provider', remove shared dependencies or avoid two-way reference
  constructor (
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider,
    readonly httpRpcClient: HttpRpcClient,
    readonly smartAccountAPI: BaseAccountAPI) {
    // accountAddress is "smartAccountAPI.getAccountAddress()", but we can't do async call here
    super(erc4337provider, config.walletAddress!)

    // wtf: I think provider no longer means what we think it means: it is JsonRpcAPIProvider, not a real provider...
    // anyway, defineReadOnly is not found anymore..
    // defineReadOnly(this, 'provider', erc4337provider)
  }

  // This one is called by Contract. It signs the request and passes in to Provider to be sent.
  async sendTransaction (transaction: TransactionRequest): Promise<TransactionResponse> {
    debug('sendTransaction', transaction)
    const tx: TransactionRequest = await this.populateTransaction(transaction)
    await this.verifyAllNecessaryFields(tx)
    const userOperation = await this.smartAccountAPI.createSignedUserOp({
      target: tx.to ?? '',
      data: tx.data?.toString() ?? '',
      value: tx.value!,
      gasLimit: tx.gasLimit!
    })
    const transactionResponse = await this.erc4337provider.constructUserOpTransactionResponse(userOperation)
    try {
      await this.httpRpcClient.sendUserOpToBundler(userOperation)
    } catch (error: any) {
      // console.error('sendUserOpToBundler failed', error)
      throw this.unwrapError(error)
    }
    // TODO: handle errors - transaction that is "rejected" by bundler is _not likely_ to ever resolve its "wait()"
    return transactionResponse
  }

  unwrapError (errorIn: any): Error {
    if (errorIn.body != null) {
      const errorBody = JSON.parse(errorIn.body)
      let paymasterInfo: string = ''
      let failedOpMessage: string | undefined = errorBody?.error?.message
      if (failedOpMessage?.includes('FailedOp') === true) {
        // TODO: better error extraction methods will be needed
        const matched = failedOpMessage.match(/FailedOp\((.*)\)/)
        if (matched != null) {
          const split = matched[1].split(',')
          paymasterInfo = `(paymaster address: ${split[1]})`
          failedOpMessage = split[2]
        }
      }
      const error = new Error(`The bundler has failed to include UserOperation in a batch: ${failedOpMessage} ${paymasterInfo})`)
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

  connect (provider: null | Provider): Signer {
    throw new Error('changing providers is not supported')
  }

  async getAddress (): Promise<string> {
    if (this.address == null) {
      this.address = await this.erc4337provider.getSenderAccountAddress()
    }
    return this.address
  }

  async signMessage (message: string | Uint8Array): Promise<string> {
    return await this.originalSigner.signMessage(message)
  }

  async signTransaction (transaction: TransactionRequest): Promise<string> {
    throw new Error('not implemented')
  }

  async signUserOperation (userOperation: UserOperationStruct): Promise<string> {
    const message = await this.smartAccountAPI.getUserOpHash(userOperation)
    return await this.originalSigner.signMessage(message)
  }
}
