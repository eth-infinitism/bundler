import { BaseProvider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers'
import { Network, Networkish } from '@ethersproject/networks'

import { UserOperation } from '@erc4337/common/src/UserOperation'

import { PaymasterAPI } from './PaymasterAPI'
import { SmartWalletAPI } from './SmartWalletAPI'
import { UserOpAPI } from './UserOpAPI'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { BigNumber, ethers, Signer } from 'ethers'
import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'
import { ClientConfig } from './ClientConfig'
import { getRequestId } from '@erc4337/common/dist/src/ERC4337Utils'
import { EntryPoint } from '@erc4337/common/dist/src/types'
import { hexValue } from 'ethers/lib/utils'
import { UserOperationEventListener } from './UserOperationEventListener'

export class ERC4337EthersProvider extends BaseProvider {
  initializedBlockNumber!: number

  readonly isErc4337Provider = true
  readonly signer: ERC4337EthersSigner

  constructor (
    network: Networkish,
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly originalProvider: BaseProvider,
    readonly entryPoint: EntryPoint,
    readonly bundlerUrl: string,
    readonly smartWalletAPI: SmartWalletAPI,
    readonly userOpAPI: UserOpAPI,
    readonly paymasterAPI?: PaymasterAPI
  ) {
    super(network)
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
