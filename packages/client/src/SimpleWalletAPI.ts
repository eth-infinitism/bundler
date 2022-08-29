import { ethers, BigNumber, Contract, BigNumberish } from 'ethers'
import { Provider } from '@ethersproject/providers'
import {
  EntryPoint,
  SimpleWallet__factory,
  SimpleWalletDeployer__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'
import { arrayify, hexConcat, resolveProperties } from 'ethers/lib/utils'
import { PaymasterAPI } from './PaymasterAPI'
import { getRequestId } from '@erc4337/common'
import { Signer } from '@ethersproject/abstract-signer'

/**
 * Base class for all Smart Wallet ERC-4337 Clients to implement.
 * Subclass should inherit 5 methods to support a specific wallet contract:
 *
 * - createWalletContract: create the wallet contract object. this contract object is used by the getNonce and encodeExecute methods.
 * - getWalletInitCode - return the value to put into the "initCode" field, if the wallet is not yet deployed. should create the wallet instance using a factory contract.
 * - getNonce - return current wallet's nonce value
 * - encodeExecute - encode the call from entryPoint through our wallet to the target contract.
 * - signRequestId - sign the requestId of a UserOp.
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
   * subclass MUST initialize, and make sure getWalletInitCode method can call it.
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
    await this.getWalletAddress()
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
  abstract getWalletInitCode (): Promise<string>

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

  /**
   * sign a userOp's hash (requestId).
   * @param requestId
   */
  abstract signRequestId(requestId: string): Promise<string>

  /**
   * check if the wallet is already deployed.
   */
  async checkWalletPhantom (): Promise<boolean> {
    if (!this.isPhantom) {
      // already deployed. no need to check anymore.
      return this.isPhantom
    }
    const senderAddressCode = await this.provider.getCode(this.getWalletAddress())
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
    const initCode = this.getWalletInitCode()
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
      return this.getWalletInitCode()
    }
    return '0x'
  }

  /**
   * return maximum gas used for verification.
   * NOTE: createUnsignedUserOp will add to this value the cost of creation, if the wallet is not yet created.
   */
  async getVerificationGasLimit (): Promise<BigNumberish> {
    return 100000
  }

  /**
   * should cover cost of putting calldata on-chain, and some overhead.
   * actual overhead depends on the expected bundle size
   */
  async getPreVerificationGas (userOp: Partial<UserOperationStruct>): Promise<number> {
    const bundleSize = 1
    let cost = 21000
    //TODO: calculate calldata cost
    return Math.floor(cost / bundleSize)
  }

  async encodeUserOpCallDataAndGasLimit (detailsForUserOp: TransactionDetailsForUserOp): Promise<{ callData: string, callGasLimit: BigNumber }> {
    if (this.walletContract == null) {
      this.walletContract = this.createWalletContract(await this.getWalletAddress())
    }

    function parseNumber (a: any): BigNumber | null {
      if (a == null || a == '') return null
      return BigNumber.from(a.toString())
    }

    const value = parseNumber(detailsForUserOp.value) ?? BigNumber.from(0)
    const callData = this.encodeExecute(detailsForUserOp.target, value, detailsForUserOp.data)

    const callGasLimit = parseNumber(detailsForUserOp.gasLimit) ?? await this.provider.estimateGas({
      from: this.entryPoint.address,
      to: this.getWalletAddress(),
      data: callData
    })

    return {
      callData,
      callGasLimit
    }
  }

  /**
   * return requestId for signing.
   * This value matches entryPoint.getRequestId (calculated off-chain, to avoid a view call)
   * @param userOp userOperation, (signature field ignored)
   */
  async getRequestId (userOp: UserOperationStruct): Promise<string> {
    const op = await resolveProperties(userOp)
    const chainId = await this.provider.getNetwork().then(net => net.chainId)
    return getRequestId(op, this.entryPoint.address, chainId)
  }

  /**
   * return the wallet's address.
   * this value is valid even before deploying the wallet.
   */
  async getWalletAddress (): Promise<string> {
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

    let {
      maxFeePerGas,
      maxPriorityFeePerGas
    } = info
    if (maxFeePerGas == null || maxPriorityFeePerGas == null) {
      const feeData = await this.provider.getFeeData()
      if (maxFeePerGas == null) {
        maxFeePerGas = feeData.maxFeePerGas!
      }
      if (maxPriorityFeePerGas == null) {
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas!
      }
    }

    const partialUserOp: any = {
      sender: this.getWalletAddress(),
      nonce: this.getNonce(),
      initCode,
      callData,
      callGasLimit,
      verificationGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    }

    partialUserOp.paymasterAndData = this.paymasterAPI == null ? '0x' : await this.paymasterAPI.getPaymasterAndData(partialUserOp)
    return {
      ...partialUserOp,
      preVerificationGas: this.getPreVerificationGas(partialUserOp),
      signature: ''
    }
  }

  /**
   * Sign the filled userOp.
   * @param userOp the UserOperation to sign (with signature field ignored)
   */
  async signUserOp (userOp: UserOperationStruct): Promise<UserOperationStruct> {
    const requestId = await this.getRequestId(userOp)
    const signature = this.signRequestId(requestId)
    return {
      ...userOp,
      signature
    }
  }

  /**
   * helper method: create and sign a user operation.
   * @param info transaction details for the userOp
   */
  async createSignedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
    return this.signUserOp(await this.createUnsignedUserOp(info))
  }
}

/**
 * An implementation of the BaseWalletAPI using the SimpleWallet contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class SimpleWalletAPI extends BaseWalletAPI {
  /**
   * base constructor.
   * subclass SHOULD add parameters that define the owner (signer) of this wallet
   * @param entryPoint entrypoint to direct the requests through
   * @param walletAddress optional wallet address, if connecting to an existing contract.
   * @param owner the signer object for the wallet owner
   * @param factoryAddress address of contract "factory" to deploy new contracts
   * @param index nonce value used when creating multiple wallets for the same owner
   */
  constructor (
    entryPoint: EntryPoint,
    walletAddress: string | undefined,
    readonly owner: Signer,
    readonly factoryAddress?: string,
    // index is "salt" used to distinguish multiple wallets of the same signer.
    readonly index = 0
  ) {
    super(entryPoint, walletAddress)
  }

  /**
   * create the wallet contract object.
   * should support our "executeFromEntryPoint" and "nonce" methods
   */
  createWalletContract (address: string): Contract {
    return SimpleWallet__factory.connect(address, this.provider)
  }

  /**
   * return the value to put into the "initCode" field, if the wallet is not yet deployed.
   * this value holds the "factory" address, followed by this wallet's infromation
   */
  async getWalletInitCode (): Promise<string> {
    if (this.factory == null) {
      if (this.factoryAddress != null) {
        this.factory = SimpleWalletDeployer__factory.connect(this.factoryAddress, this.provider)
      } else {
        throw new Error('no factory to get initCode')
      }
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData('deployWallet', [this.entryPoint.address, await this.owner.getAddress(), this.index])
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

  async signRequestId(requestId: string): Promise<string> {
    return this.owner.signMessage(arrayify(requestId))
  }
}
