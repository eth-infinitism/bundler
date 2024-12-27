import { BigNumberish } from 'ethers'
import { JsonRpcProvider, TransactionReceipt } from '@ethersproject/providers'
import {
  AddressZero,
  EIP7702Authorization,
  OperationBase,
  OperationRIP7560,
  StorageMap,
  getPackedNonce,
  getRIP7560TransactionHash,
  requireCond
} from '@account-abstraction/utils'
import { ExecutionManager } from './modules/ExecutionManager'
import { HEX_REGEX } from './MethodHandlerERC4337'

export interface RIP7560TransactionReceipt extends TransactionReceipt {

}

export class MethodHandlerRIP7560 {
  constructor (
    readonly execManager: ExecutionManager,
    readonly provider: JsonRpcProvider
  ) {}

  async sendRIP7560Transaction (transaction: OperationRIP7560, skipValidation: boolean): Promise<string> {
    await this._validateParameters(transaction)
    console.log(`RIP7560Transaction: Sender=${transaction.sender}  Nonce=${getPackedNonce(transaction).toHexString()} Paymaster=${transaction.paymaster ?? ''}`)
    await this.execManager.sendUserOperation(transaction, '', skipValidation)
    return getRIP7560TransactionHash(transaction)
  }

  /**
   * @param minBaseFee
   * @param maxBundleGas
   * @param maxBundleSize
   * @return An array of transactions included in the bundle.
   * @return The EIP7702Authorization array is always empty as each individual RIP-7560 transaction performs its own authorizations.
   */
  async getRip7560Bundle (
    minBaseFee: BigNumberish,
    maxBundleGas: BigNumberish,
    maxBundleSize: BigNumberish
  ): Promise<[OperationBase[], EIP7702Authorization[], StorageMap]> {
    return await this.execManager.createBundle(minBaseFee, maxBundleGas, maxBundleSize)
  }

  async getRIP7560TransactionReceipt (txHash: string): Promise<RIP7560TransactionReceipt | null> {
    requireCond(txHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    return await this.provider.getTransactionReceipt(txHash)
  }

  // TODO: align parameter names across 4337 and 7560
  async _validateParameters (transaction: OperationRIP7560): Promise<void> {
    (transaction as any).deployer = transaction.factory ?? AddressZero;
    (transaction as any).deployerData = transaction.factoryData ?? '0x'
    transaction.paymaster = transaction.paymaster ?? AddressZero
    transaction.paymasterData = transaction.paymasterData ?? '0x'
    transaction.callGasLimit = transaction.callGasLimit ?? (transaction as any).gas;
    (transaction as any).gas = transaction.callGasLimit
    transaction.verificationGasLimit = transaction.verificationGasLimit ?? (transaction as any).validationGas
    transaction.paymasterVerificationGasLimit = transaction.paymasterVerificationGasLimit ?? (transaction as any).paymasterValidationGas
  }
}
