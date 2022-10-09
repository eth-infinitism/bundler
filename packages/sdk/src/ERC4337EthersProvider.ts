import { BaseProvider, TransactionReceipt, TransactionResponse } from '@ethersproject/providers'
import { BigNumber, Signer } from 'ethers'
import { Network } from '@ethersproject/networks'
import { hexValue, resolveProperties } from 'ethers/lib/utils'

import { ClientConfig } from './ClientConfig'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { UserOperationEventListener } from './UserOperationEventListener'
import { HttpRpcClient } from './HttpRpcClient'
import { EntryPoint, UserOperationStruct } from '@account-abstraction/contracts'
import { getRequestId } from '@account-abstraction/utils'
import { BaseWalletAPI } from './BaseWalletAPI'
import Debug from 'debug'
const debug = Debug('aa.provider')

export class ERC4337EthersProvider extends BaseProvider {
  initializedBlockNumber!: number

  readonly signer: ERC4337EthersSigner

  constructor (
    readonly chainId: number,
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly originalProvider: BaseProvider,
    readonly httpRpcClient: HttpRpcClient,
    readonly entryPoint: EntryPoint,
    readonly smartWalletAPI: BaseWalletAPI
  ) {
    super({
      name: 'ERC-4337 Custom Network',
      chainId
    })
    this.signer = new ERC4337EthersSigner(config, originalSigner, this, httpRpcClient, smartWalletAPI)
  }

  /**
   * finish intializing the provider.
   * MUST be called after construction, before using the provider.
   */
  async init (): Promise<this> {
    // await this.httpRpcClient.validateChainId()
    this.initializedBlockNumber = await this.originalProvider.getBlockNumber()
    await this.smartWalletAPI.init()
    // await this.signer.init()
    return this
  }

  getSigner (): ERC4337EthersSigner {
    return this.signer
  }

  async perform (method: string, params: any): Promise<any> {
    debug('perform', method, params)
    if (method === 'sendTransaction' || method === 'getTransactionReceipt') {
      // TODO: do we need 'perform' method to be available at all?
      // there is nobody out there to use it for ERC-4337 methods yet, we have nothing to override in fact.
      throw new Error('Should not get here. Investigate.')
    }
    return await this.originalProvider.perform(method, params)
  }

  async getTransaction (transactionHash: string | Promise<string>): Promise<TransactionResponse> {
    // TODO
    return await super.getTransaction(transactionHash)
  }

  async getTransactionReceipt (transactionHash: string | Promise<string>): Promise<TransactionReceipt> {
    const requestId = await transactionHash
    const sender = await this.getSenderWalletAddress()
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, this.entryPoint, sender, requestId
      ).start()
    })
  }

  async getSenderWalletAddress (): Promise<string> {
    return await this.smartWalletAPI.getWalletAddress()
  }

  async waitForTransaction (transactionHash: string, confirmations?: number, timeout?: number): Promise<TransactionReceipt> {
    const sender = await this.getSenderWalletAddress()

    return await new Promise<TransactionReceipt>((resolve, reject) => {
      const listener = new UserOperationEventListener(resolve, reject, this.entryPoint, sender, transactionHash, undefined, timeout)
      listener.start()
    })
  }

  // fabricate a response in a format usable by ethers users...
  async constructUserOpTransactionResponse (userOp1: UserOperationStruct): Promise<TransactionResponse> {
    const userOp = await resolveProperties(userOp1)
    const requestId = getRequestId(userOp, this.config.entryPointAddress, this.chainId)
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
      gasLimit: BigNumber.from(userOp.callGasLimit), // ??
      value: BigNumber.from(0),
      data: hexValue(userOp.callData), // should extract the actual called method from this "execFromEntryPoint()" call
      chainId: this.chainId,
      wait: async (confirmations?: number): Promise<TransactionReceipt> => {
        const transactionReceipt = await waitPromise
        if (userOp.initCode.length !== 0) {
          // checking if the wallet has been deployed by the transaction; it must be if we are here
          await this.smartWalletAPI.checkWalletPhantom()
        }
        return transactionReceipt
      }
    }
  }

  async detectNetwork (): Promise<Network> {
    return (this.originalProvider as any).detectNetwork()
  }
}
