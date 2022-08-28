import { ethers, BigNumber, Contract, BigNumberish } from 'ethers'
import { Provider } from '@ethersproject/providers'
import {
  EntryPoint,
  SimpleWallet__factory,
  SimpleWalletDeployer__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'
import { hexConcat } from 'ethers/lib/utils'
import { PaymasterAPI } from './PaymasterAPI'

/**
 * Base class for all Smart Wallet ERC-4337 Clients to implement.
 */
export abstract class BaseWalletAPI {
  private senderAddress!: string
  protected readonly provider: Provider
  protected walletContract!: Contract
  private isPhantom = true
  // entryPoint connected to "zero" address. allowed to make static calls (e.g. to getSenderAddress)
  private readonly entryPointView: EntryPoint

  /**
   * factory contract to deploy the wallet.
   * subclass must initialize, and make sure _getWalletInitCode method can call it.
   */
  factory?: Contract

  /**
   * subclass MAY initialize to support custom paymaster
   */
  paymasterAPI?: PaymasterAPI

  /**
   * base constructor.
   * subclass SHOULD add parameters that define the owner (signer) of this wallet
   * @param entryPoint
   * @param walletAddress. may be empty for new wallet (using factory to determine address
   */
  protected constructor (
    readonly entryPoint: EntryPoint,
    readonly walletAddress?: string
  ) {
    this.provider = entryPoint.provider
    this.entryPointView = entryPoint.connect(ethers.constants.AddressZero)
  }

  async init (): Promise<this> {
    await this.getSender()
    return this
  }

  /**
   * create the wallet contract object.
   * should support our "encodeExecute" and "nonce" methods
   */
  abstract createWalletContract (address: string): Contract

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's information
   */
  abstract _getWalletInitCode (): string

  /**
   * return current wallet's nonce.
   */
  abstract getNonce (): Promise<BigNumber>

  /**
   * encode the call from entryPoint through our wallet to the target contract.
   * @param target
   * @param value
   * @param data
   */
  abstract encodeExecute (target: string, value: BigNumberish, data: string): string

  async checkWalletPhantom (): Promise<boolean> {
    if (!this.isPhantom) {
      return this.isPhantom
    }
    const senderAddressCode = await this.provider.getCode(this.getSender())
    if (senderAddressCode.length > 2) {
      console.log(`SimpleWallet Contract already deployed at ${this.senderAddress}`)
      this.isPhantom = false
      this.walletContract = this.walletContract.attach(this.senderAddress).connect(this.provider)
    } else {
      console.log(`SimpleWallet Contract is NOT YET deployed at ${this.senderAddress} - working in "phantom wallet" mode.`)
    }
    return this.isPhantom
  }

  /**
   * calculate the wallet address even before it is deployed
   */
  async getCounterFactualAddress (): Promise<string> {
    const initCode = this._getWalletInitCode()
    // use entryPoint to query wallet address (factory can provide a helper method to do the same, but
    // this method attempts to be generic
    return await this.entryPointView.callStatic.getSenderAddress(initCode)
  }

  /**
   * return initCode value to into the UserOp.
   * (either deployment code, or empty hex if contract already deployed)
   */
  async getInitCode (): Promise<string> {
    if (await this.checkWalletPhantom()) {
      return this._getWalletInitCode()
    }
    return '0x'
  }

  async getVerificationGasLimit (): Promise<BigNumberish> {
    return 400000
  }

  async getMaxFeePerGas (): Promise<BigNumberish> {
    const feeData = await this.provider.getFeeData()
    return feeData.maxFeePerGas ?? 0
  }

  async getmaxPriorityFeePerGas (): Promise<BigNumberish> {
    const feeData = await this.provider.getFeeData()
    return feeData.maxPriorityFeePerGas ?? 0
  }

  /**
   * should cover cost of putting calldata on-chain, and some overhead.
   * actual overhead depends on the expected bundle.
   */
  async getPreVerificationGas (userOp: Partial<UserOperationStruct>): Promise<number> {
    // return 21000
    return 0
  }

  /**
   * wallet-specific API: call (from the wallet contract) the target address, with this given calldata.
   * TBD: We are assuming there is only the Wallet that impacts the resulting CallData here.
   */
  async encodeUserOpCallDataAndGasLimit (detailsForUserOp: TransactionDetailsForUserOp): Promise<{ callData: string, callGasLimit: BigNumber }> {
    if (this.walletContract == null) {
      this.walletContract = this.createWalletContract(await this.getSender())
    }
    let value = BigNumber.from(0)
    if (detailsForUserOp.value !== '') {
      value = BigNumber.from(detailsForUserOp.value)
    }
    const callData = this.encodeExecute(detailsForUserOp.target, value, detailsForUserOp.data)

    const gasLimit = detailsForUserOp.gasLimit ?? '0'
    let callGasLimit = BigNumber.from(gasLimit === '' ? '0' : gasLimit)
    if (callGasLimit === BigNumber.from(0)) {
      callGasLimit = await this.provider.estimateGas({
        from: this.entryPoint.address,
        to: this.getSender(),
        data: callData
      })
    }
    return {
      callData,
      callGasLimit
    }
  }

  async getSender (): Promise<string> {
    if (this.senderAddress == null) {
      if (this.walletAddress != null) {
        this.senderAddress = this.walletAddress
      } else {
        this.senderAddress = await this.getCounterFactualAddress()
      }
    }
    return this.senderAddress
  }

  /**
   * create a UserOperation, filling all details (except signature)
   * - if wallet is not yet created, add initCode to deploy it.
   * - if gas or nonce are missing, read them from the chain (note that we can't fill gaslimit before the wallet is created)
   * @param info
   */
  async createUnsignedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
    const {
      callData,
      callGasLimit
    } = await this.encodeUserOpCallDataAndGasLimit(info)
    const initCode = await this.getInitCode()
    let verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit())
    if (initCode.length > 2) {
      // add creation to required verification gas
      const initGas = await this.entryPointView.estimateGas.getSenderAddress(initCode)
      verificationGasLimit = verificationGasLimit.add(initGas)
    }

    const partialUserOp: any = {
      sender: this.getSender(),
      nonce: this.getNonce(),
      initCode,
      callData,
      callGasLimit,
      verificationGasLimit,
      maxFeePerGas: info.maxFeePerGas ?? this.getMaxFeePerGas(),
      maxPriorityFeePerGas: info.maxPriorityFeePerGas ?? this.getmaxPriorityFeePerGas()
    }

    partialUserOp.paymasterAndData = this.paymasterAPI == null ? '0x' : await this.paymasterAPI.getPaymasterAndData(partialUserOp)
    return {
      ...partialUserOp,
      preVerificationGas: this.getPreVerificationGas(partialUserOp),
      signature: ''
    }
  }
}

/**
 * a wallet API for a SimpleWallet.
 * assumes owner is a normal ethereum address.
 * assumes deployer takes owner and nonce parametrs
 */
export class SimpleWalletAPI extends BaseWalletAPI {
  /**
   * base constructor.
   * subclass SHOULD add parameters that define the owner (signer) of this wallet
   * @param entryPoint entrypoint to direct the requests through
   * @param walletAddress optional wallet address, if connecting to an existing contract.
   * @param ownerAddress the signer address
   * @param factoryAddress address of contract "factory" to deploy new contracts
   * @param index nonce value used when creating multiple wallets for the same owner
   */
  constructor (
    entryPoint: EntryPoint,
    walletAddress: string | undefined,
    readonly ownerAddress: string,
    readonly factoryAddress?: string,
    // index is "salt" used to distinguish multiple wallets of the same signer.
    readonly index = 0
  ) {
    super(entryPoint, walletAddress)
  }

  /**
   * create the wallet contract object.
   * should support our "executeFromSingleton" and "nonce" methods
   */
  createWalletContract (address: string): Contract {
    return SimpleWallet__factory.connect(address, this.provider)
  }

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's infromation
   */
  _getWalletInitCode (): string {
    if (this.factory == null) {
      if (this.factoryAddress != null) {
        this.factory = SimpleWalletDeployer__factory.connect(this.factoryAddress, this.provider)
      } else {
        throw new Error('no factory to get initCode')
      }
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData('deployWallet', [this.entryPoint.address, this.ownerAddress, this.index])
    ])
  }

  async getNonce (): Promise<BigNumber> {
    if (await this.checkWalletPhantom()) {
      return BigNumber.from(0)
    }
    return this.walletContract.nonce()
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  encodeExecute (target: string, value: BigNumberish, data: string): string {
    return this.walletContract.interface.encodeFunctionData(
      'execFromEntryPoint',
      [
        target,
        value,
        data
      ])
  }
}
