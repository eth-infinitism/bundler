import { Deferrable, defineReadOnly } from '@ethersproject/properties'
import { Provider, TransactionReceipt, TransactionRequest, TransactionResponse } from '@ethersproject/providers'
import { Signer } from '@ethersproject/abstract-signer'

import { BigNumber, Bytes } from 'ethers'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { hexValue } from 'ethers/lib/utils'
import { getRequestId, getRequestIdForSigning } from '@erc4337/common/src/ERC4337Utils'
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
    // code from super;
    // this._checkProvider('sendTransaction')
    // const signedTx = await this.signTransaction(tx)
    // // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    // return await this.provider!.sendTransaction(signedTx)

    const tx: TransactionRequest = await this.populateTransaction(transaction)
    // must do:
    await this.verifyAllNecessaryFields(tx)
    const userOperation = await this.erc4337provider.createUserOp({
      target: tx.to ?? '',
      data: tx.data?.toString() ?? '',
      value: tx.value?.toString() ?? ''
    })
    userOperation.signature = await this.signUserOperation(userOperation)
    return await this.constructUserOpTransactionResponse(userOperation)
  }

  async constructUserOpTransactionResponse (userOp: UserOperation): Promise<TransactionResponse> {
    const requestId = getRequestId(userOp, this.config.entryPointAddress, this.config.chainId)
    const resp: TransactionResponse = {
      hash: requestId,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGas), // ??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData), // should extract the actual called method from this "execFromSingleton()" call
      chainId: this.config.chainId,
      wait: async function (confirmations?: number): Promise<TransactionReceipt> {
        // TODO: migrate transaction receipt getter function
        // @ts-ignore
        return await Promise.resolve()
      }
    }
    return resp
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
