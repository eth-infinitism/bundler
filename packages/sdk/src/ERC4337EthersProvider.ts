import {
  getBigInt, hexlify,
  JsonRpcProvider,
  JsonRpcSigner,
  Network,
  Signature,
  TransactionReceipt,
  TransactionResponse,
  TransactionResponseParams, Signer, Provider, toNumber
} from 'ethers'

import { ClientConfig } from './ClientConfig'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { UserOperationEventListener } from './UserOperationEventListener'
import { HttpRpcClient } from './HttpRpcClient'
import { EntryPoint, UserOperationStruct } from '@account-abstraction/utils/dist/src/ContractTypes'
import { getUserOpHash } from '@account-abstraction/utils'
import { BaseAccountAPI } from './BaseAccountAPI'
import Debug from 'debug'

const debug = Debug('aa.provider')

class ERC4337TransactionResponse extends TransactionResponse {
  userOpHash: string

  constructor (
    readonly txParams: TransactionResponseParams,
    readonly entryPoint: EntryPoint,
    readonly userOp: UserOperationStruct,
    readonly smartAccountAPI: BaseAccountAPI,
    provider: JsonRpcProvider
  ) {
    super(txParams, provider)
    this.userOpHash = txParams.hash
  }

  async wait (_confirms?: number, _timeout?: number): Promise<TransactionReceipt | null> {

    const waitForUserOp = async (): Promise<TransactionReceipt> => await new Promise((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, this.entryPoint, this.userOp.sender, this.userOpHash, this.userOp.nonce
      ).start()
    })

    const transactionReceipt = await waitForUserOp()
    if (this.userOp.initCode.length !== 0) {
      // checking if the wallet has been deployed by the transaction; it must be if we are here
      await this.smartAccountAPI.checkAccountPhantom()
    }
    return transactionReceipt
  }
}

export class ERC4337EthersProvider extends JsonRpcProvider {
  initializedBlockNumber!: number

  readonly signer: ERC4337EthersSigner

  constructor (
    readonly chainId: number,
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly originalProvider: Provider,
    readonly httpRpcClient: HttpRpcClient,
    readonly entryPoint: EntryPoint,
    readonly smartAccountAPI: BaseAccountAPI,
  ) {
    super('', {
      name: 'ERC-4337 Custom Network',
      chainId
    })
    this.signer = new ERC4337EthersSigner(config, originalSigner, this, httpRpcClient, smartAccountAPI)
  }

  /**
   * finish intializing the provider.
   * MUST be called after construction, before using the provider.
   */
  async init (): Promise<this> {
    // await this.httpRpcClient.validateChainId()
    this.initializedBlockNumber = await this.originalProvider.getBlockNumber()
    await this.smartAccountAPI.init()
    // await this.signer.init()
    return this
  }

  async getSigner (address?: number | string): Promise<JsonRpcSigner> {
    return this.signer
  }

  async perform (method: string, params: any): Promise<any> {
    debug('perform', method, params)
    if (method === 'sendTransaction' || method === 'getTransactionReceipt') {
      // TODO: do we need 'perform' method to be available at all?
      // there is nobody out there to use it for ERC-4337 methods yet, we have nothing to override in fact.
      throw new Error('Should not get here. Investigate.')
    }
    return await (this.originalProvider.provider as JsonRpcProvider).send(method, params)
  }

  async getTransaction (transactionHash: string): Promise<null | TransactionResponse> {
    // TODO
    return await super.getTransaction(transactionHash)
  }

  async getTransactionReceipt (transactionHash: string): Promise<null | TransactionReceipt> {
    const userOpHash = await transactionHash
    const sender = await this.getSenderAccountAddress()
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(
        resolve, reject, this.entryPoint, sender, userOpHash
      ).start()
    })
  }

  async getSenderAccountAddress (): Promise<string> {
    return await this.smartAccountAPI.getAccountAddress()
  }

  async waitForTransaction (transactionHash: string, confirmations?: number, timeout?: number): Promise<TransactionReceipt> {
    const sender = await this.getSenderAccountAddress()

    return await new Promise<TransactionReceipt>((resolve, reject) => {
      const listener = new UserOperationEventListener(resolve, reject, this.entryPoint, sender, transactionHash, undefined, timeout)
      listener.start()
    })
  }

  // fabricate a response in a format usable by ethers users...
  async constructUserOpTransactionResponse (userOp: UserOperationStruct): Promise<TransactionResponse> {
    const userOpHash = getUserOpHash(userOp, this.config.entryPointAddress, this.chainId)

    const txParams: TransactionResponseParams = {
      blockNumber: null,
      blockHash: null,
      hash: userOpHash,
      index: 0,
      type: 0,
      to: userOp.sender.toString(), //todo: extract target from callData?
      from: userOp.sender.toString(),
      nonce: toNumber(userOp.nonce),
      gasLimit: getBigInt(userOp.callGasLimit),
      gasPrice: getBigInt(userOp.maxFeePerGas),
      maxPriorityFeePerGas: getBigInt(userOp.maxPriorityFeePerGas),
      maxFeePerGas: getBigInt(userOp.maxFeePerGas),
      data: hexlify(userOp.callData), //TODO: extract calldata?
      value: 0n, //TODO: extract from callData ?
      chainId: getBigInt(this.chainId),
      signature: Signature.from(hexlify(userOp.signature)),
      accessList: null
    }

    return new ERC4337TransactionResponse(txParams, this.entryPoint, userOp, this.smartAccountAPI, this.provider)
  }

  async detectNetwork (): Promise<Network> {
    return (this.originalProvider as any).detectNetwork()
  }
}
