import { JsonRpcProvider, TransactionReceipt } from '@ethersproject/providers'
import {
  AddressZero,
  getRIP7560TransactionHash,
  OperationRIP7560,
  requireCond,
  tostr
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

  async sendRIP7560Transaction (transaction: OperationRIP7560): Promise<string> {
    await this._validateParameters(transaction)
    console.log(`RIP7560Transaction: Sender=${transaction.sender}  Nonce=${tostr(transaction.nonce)} Paymaster=${transaction.paymaster ?? ''}`)
    await this.execManager.sendUserOperation(transaction, '')
    return getRIP7560TransactionHash(transaction)
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
    (transaction as any).gas = transaction.callGasLimit;
    (transaction as any).data = transaction.callData
    transaction.verificationGasLimit = transaction.verificationGasLimit ?? (transaction as any).validationGas
    transaction.paymasterVerificationGasLimit = transaction.paymasterVerificationGasLimit ?? (transaction as any).paymasterValidationGas
  }
}
