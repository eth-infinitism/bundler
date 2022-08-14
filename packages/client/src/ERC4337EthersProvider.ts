import { ConnectionInfo } from '@ethersproject/web'
import { BaseProvider, Provider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers'
import { Network, Networkish } from '@ethersproject/networks'

import { UserOperation } from '@erc4337/common/src/UserOperation'

import { PaymasterAPI } from './PaymasterAPI'
import { SmartWalletAPI } from './SmartWalletAPI'
import { UserOpAPI } from './UserOpAPI'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { Signer } from 'ethers'
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'

export class ERC4337EthersProvider extends BaseProvider {
  readonly isErc4337Provider = true
  readonly signer: ERC4337EthersSigner

  constructor (
    network: Networkish,
    readonly originalSigner: Signer,
    readonly originalProvider: BaseProvider,
    private readonly bundlerUrl: string,
    private readonly smartWalletAPI: SmartWalletAPI,
    private readonly userOpAPI: UserOpAPI,
    private readonly paymasterAPI?: PaymasterAPI
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
    return await this.originalProvider.perform(method, params)
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

  async createUserOp (detailsForUserOp: TransactionDetailsForUserOp): Promise<UserOperation> {
    const callData = await this.encodeUserOpCallData(detailsForUserOp)
    const nonce = await this.smartWalletAPI.getNonce()
    const sender = await this.smartWalletAPI.getSender()
    const initCode = await this.smartWalletAPI.getInitCode()

    const callGas = await this.smartWalletAPI.getCallGas()
    const verificationGas = await this.smartWalletAPI.getVerificationGas()
    const preVerificationGas = await this.smartWalletAPI.getPreVerificationGas()

    let paymaster: string = ''
    let paymasterData: string = ''
    if (this.paymasterAPI != null) {
      paymaster = await this.paymasterAPI.getPaymasterAddress()
      paymasterData = await this.paymasterAPI.getPaymasterData()
    }
    const { maxFeePerGas, maxPriorityFeePerGas } = await this.getFeeData()

    if (maxPriorityFeePerGas == null || maxFeePerGas == null) {
      throw new Error('Type-0 not supported')
    }

    return {
      signature: '',
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymaster,
      paymasterData,
      verificationGas,
      preVerificationGas,
      callGas,
      callData,
      nonce,
      sender,
      initCode
    }
  }

  async encodeUserOpCallData (detailsForUserOp: TransactionDetailsForUserOp): Promise<string> {
    const encodedData = await this.smartWalletAPI.encodeUserOpCallData(detailsForUserOp)
    console.log(encodedData, JSON.stringify(detailsForUserOp))
    return encodedData
  }

  async detectNetwork (): Promise<Network> {
    return (this.originalProvider as any).detectNetwork()
  }

}
