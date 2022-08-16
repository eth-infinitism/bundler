import { BaseProvider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers'
import { BigNumber, ethers, Signer } from 'ethers'
import { Network } from '@ethersproject/networks'
import { hexValue } from 'ethers/lib/utils'

import { EntryPoint } from '@erc4337/common/dist/src/types'
import { UserOperation } from '@erc4337/common/dist/src/UserOperation'
import { getRequestId } from '@erc4337/common/dist/src/ERC4337Utils'

import { ClientConfig } from './ClientConfig'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { PaymasterAPI } from './PaymasterAPI'
import { SimpleWalletAPI } from './SimpleWalletAPI'
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'
import { UserOpAPI } from './UserOpAPI'
import { UserOperationEventListener } from './UserOperationEventListener'

export class ERC4337EthersProvider extends BaseProvider {
  initializedBlockNumber!: number

  readonly isErc4337Provider = true
  readonly signer: ERC4337EthersSigner

  constructor (
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly originalProvider: BaseProvider,
    readonly entryPoint: EntryPoint,
    readonly smartWalletAPI: SimpleWalletAPI,
    readonly userOpAPI: UserOpAPI,
    readonly paymasterAPI?: PaymasterAPI
  ) {
    super({
      name: 'ERC-4337 Custom Network',
      chainId: config.chainId
    })
    this.signer = new ERC4337EthersSigner(config, originalSigner, this)
  }

  async init (): Promise<this> {
    this.initializedBlockNumber = await this.originalProvider.getBlockNumber()
    await this.smartWalletAPI.init()
    // await this.signer.init()
    return this
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

  async getTransaction (transactionHash: string | Promise<string>): Promise<TransactionResponse> {
    return await super.getTransaction(transactionHash)
  }

  async getTransactionReceipt (transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
    const requestId = await transactionHash
    const sender = await this.smartWalletAPI.getSender()
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, this.entryPoint, sender, requestId
      ).start()
    })
  }

  async createUserOp (detailsForUserOp: TransactionDetailsForUserOp): Promise<UserOperation> {
    const callData = await this.encodeUserOpCallData(detailsForUserOp)
    const nonce = await this.smartWalletAPI.getNonce()
    const sender = await this.smartWalletAPI.getSender()
    const initCode = await this.smartWalletAPI.getInitCode()

    const callGas = await this.smartWalletAPI.getCallGas()
    const verificationGas = await this.smartWalletAPI.getVerificationGas()
    const preVerificationGas = await this.smartWalletAPI.getPreVerificationGas()

    let paymaster: string = ethers.constants.AddressZero
    let paymasterData: string = '0x'
    if (this.paymasterAPI != null) {
      paymaster = await this.paymasterAPI.getPaymasterAddress()
      paymasterData = await this.paymasterAPI.getPaymasterData()
    }
    const {
      maxFeePerGas,
      maxPriorityFeePerGas
    } = await this.getFeeData()

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

  // fabricate a response in a format usable by ethers users...
  async constructUserOpTransactionResponse (userOp: UserOperation): Promise<TransactionResponse> {
    const requestId = getRequestId(userOp, this.config.entryPointAddress, this.config.chainId)
    const waitPromise = new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, this.entryPoint, userOp.sender, requestId, userOp.nonce
      ).start()
    })
    return {
      hash: requestId,
      confirmations: 0,
      from: userOp.sender,
      nonce: BigNumber.from(userOp.nonce).toNumber(),
      gasLimit: BigNumber.from(userOp.callGas), // ??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData), // should extract the actual called method from this "execFromSingleton()" call
      chainId: this.config.chainId,
      wait: async function (confirmations?: number): Promise<TransactionReceipt> {
        return await waitPromise
      }
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
