import {
  getBigInt, hexlify,
  Network,
  Signature,
  TransactionReceipt,
  TransactionResponse,
  TransactionResponseParams, Signer, Provider, toNumber, AbstractProvider
} from 'ethers'

import { ClientConfig } from './ClientConfig'
import { ERC4337EthersSigner } from './ERC4337EthersSigner'
import { UserOperationEventListener } from './UserOperationEventListener'
import { HttpRpcClient } from './HttpRpcClient'
import { EntryPoint, UserOperationStruct } from '@account-abstraction/utils/dist/src/ContractTypes'
import { getUserOpHash, toLowerAddr } from '@account-abstraction/utils'
import { BaseAccountAPI } from './BaseAccountAPI'
import Debug from 'debug'
import { assert } from 'ethers/src.ts/utils'
import { PerformActionRequest } from 'ethers/src.ts/providers/abstract-provider'

const debug = Debug('aa.provider')

class ERC4337TransactionResponse extends TransactionResponse {
  userOpHash: string

  constructor (
    readonly erc4337Provider: ERC4337EthersProvider,
    readonly txParams: TransactionResponseParams,
    readonly entryPoint: EntryPoint,
    readonly userOp: UserOperationStruct,
    readonly smartAccountAPI: BaseAccountAPI,
    provider: ERC4337EthersProvider
  ) {
    super(txParams, provider)
    this.userOpHash = txParams.hash
  }

  async wait (_confirms?: number, _timeout?: number): Promise<TransactionReceipt | null> {
    const waitForUserOp = async (): Promise<TransactionReceipt> => await new Promise((resolve, reject) => {
      new UserOperationEventListener(this.erc4337Provider,
        resolve, reject, this.userOp.sender, this.userOpHash, this.userOp.nonce
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

export class ERC4337EthersProvider extends AbstractProvider {

  initializedBlockNumber!: number

  readonly signer: ERC4337EthersSigner

  constructor (
    readonly chainId: number,
    readonly config: ClientConfig,
    readonly originalSigner: Signer,
    readonly originalProvider: Provider,
    readonly httpRpcClient: HttpRpcClient,
    readonly entryPoint: EntryPoint,
    readonly smartAccountAPI: BaseAccountAPI
  ) {
    super(chainId)
    this.signer = new ERC4337EthersSigner(config, originalSigner, this, httpRpcClient, smartAccountAPI)
  }

  _detectNetwork (): Promise<Network> {
    return this.originalProvider.getNetwork()
  }

  async _perform (req: PerformActionRequest): Promise<any> {
    const keys = Object.keys(req).slice(1)
    let params = keys.map(key => (req as any)[key])
    debug('>> perform', req.method, 'keys=', keys, 'params=', params)
    let ret = await (this.originalProvider as any)[req.method](...params)
    return ret
    // throw Error(req.method)
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
    return await (this.originalProvider.provider as any).send(method, params)
  }

  async getTransaction (transactionHash: string): Promise<null | TransactionResponse> {
    // TODO
    return await super.getTransaction(transactionHash)
  }

  async getTransactionReceipt (transactionHash: string): Promise<null | TransactionReceipt> {
    const userOpHash = transactionHash
    const sender = await this.getSenderAccountAddress()
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      new UserOperationEventListener(this,
        resolve, reject, sender, userOpHash
      ).start()
    })
  }

  async getSenderAccountAddress (): Promise<string> {
    return await this.smartAccountAPI.getAccountAddress()
  }

  async waitForTransaction (transactionHash: string, confirmations?: number, timeout?: number): Promise<TransactionReceipt> {
    const sender = await this.getSenderAccountAddress()

    return await new Promise<TransactionReceipt>((resolve, reject) => {
      const listener = new UserOperationEventListener(this, resolve, reject, sender, transactionHash, undefined, timeout)
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
      to: toLowerAddr(userOp.sender), // todo: extract target from callData?
      from: toLowerAddr(userOp.sender),
      nonce: toNumber(userOp.nonce),
      gasLimit: getBigInt(userOp.callGasLimit),
      gasPrice: getBigInt(userOp.maxFeePerGas),
      maxPriorityFeePerGas: getBigInt(userOp.maxPriorityFeePerGas),
      maxFeePerGas: getBigInt(userOp.maxFeePerGas),
      data: hexlify(userOp.callData), // TODO: extract calldata?
      value: 0n, // TODO: extract from callData ?
      chainId: getBigInt(this.chainId),
      signature: Signature.from(hexlify(userOp.signature)),
      accessList: null
    }

    return new ERC4337TransactionResponse(this, txParams, this.entryPoint, userOp, this.smartAccountAPI, this.provider)
  }

  async detectNetwork (): Promise<Network> {
    return (this.originalProvider as any).detectNetwork()
  }
}
