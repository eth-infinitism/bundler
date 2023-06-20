import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { ClientConfig } from './ClientConfig'
import { HttpRpcClient } from './HttpRpcClient'
import {
  UserOperationStruct
} from '@account-abstraction/utils/src/ContractTypes'
import { BaseAccountAPI } from './BaseAccountAPI'
import {
  AbstractSigner,
  JsonRpcSigner,
  Provider,
  Signer,
  TransactionRequest,
  TransactionResponse,
  TypedDataDomain, TypedDataField
} from 'ethers'
import Debug from 'debug'
import { BlockTag } from 'ethers/src.ts/providers/provider'

const debug = Debug('aa.signer')

export class ERC4337EthersSigner extends AbstractSigner {

  private address?: string

  // TODO: we have 'erc4337provider', remove shared dependencies or avoid two-way reference
  constructor (
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly erc4337provider: ERC4337EthersProvider,
    readonly httpRpcClient: HttpRpcClient,
    readonly smartAccountAPI: BaseAccountAPI) {
    super(erc4337provider)

    // wtf: I think provider no longer means what we think it means: it is JsonRpcAPIProvider, not a real provider...
    // anyway, defineReadOnly is not found anymore..
    // defineReadOnly(this, 'provider', erc4337provider)
  }

  // This one is called by Contract. It signs the request and passes in to Provider to be sent.
  async sendTransaction (transaction: TransactionRequest): Promise<TransactionResponse> {
    const tx: TransactionRequest = await this.populateTransaction(transaction)
    await this.verifyAllNecessaryFields(tx)
    // IDE requires "!" to mark non-null, but eslint rejects it. both are happy with "?? ''"
    const userOperation = await this.smartAccountAPI.createSignedUserOp({
      target: tx.to ?? '',
      data: tx.data?.toString() ?? '',
      value: tx.value ?? 0n,
      gasLimit: tx.gasLimit ?? 0n
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

  signTypedData (domain: TypedDataDomain, types: Record<string, Array<TypedDataField>>, value: Record<string, any>): Promise<string> {
    throw new Error('not implemented')
  }

  async getNonce(blockTag?: BlockTag): Promise<number> {
    const nonce =  this.smartAccountAPI.getNonce()
    //TODO: getNonce's API return a "number". we can't fit this range. assume caller can handle bitint..
    return nonce as any
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
