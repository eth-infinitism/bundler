import { JsonRpcProvider, TransactionReceipt } from '@ethersproject/providers'
import {
  getRIP7560TransactionHash,
  requireCond,
  RIP7560Transaction,
  tostr
} from '@account-abstraction/utils'
import { HEX_REGEX } from './UserOpMethodHandler'
import { ExecutionManager } from './modules/ExecutionManager'

export interface RIP7560TransactionReceipt extends TransactionReceipt {

}

export class RIP7560MethodHandler {
  constructor (
    readonly execManager: ExecutionManager,
    readonly provider: JsonRpcProvider
  ) {}

  async sendRIP7560Transaction (transaction: RIP7560Transaction): Promise<string> {
    await this._validateParameters(transaction)
    console.log(`RIP7560Transaction: Sender=${transaction.sender}  Nonce=${tostr(transaction.nonce)} Paymaster=${transaction.paymaster ?? ''}`)
    await this.execManager.sendUserOperation(transaction)
    return getRIP7560TransactionHash(transaction)
  }

  async getRIP7560TransactionReceipt (txHash: string): Promise<RIP7560TransactionReceipt | null> {
    requireCond(txHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32601)
    return await this.provider.getTransactionReceipt(txHash)
  }

  // TODO: align parameter names across 4337 and 7560
  async _validateParameters (transaction: RIP7560Transaction): Promise<void> {
    transaction.callGasLimit = transaction.callGasLimit ?? (transaction as any).gas
    transaction.verificationGasLimit = transaction.verificationGasLimit ?? (transaction as any).validationGas
    transaction.paymasterVerificationGasLimit = transaction.paymasterVerificationGasLimit ?? (transaction as any).paymasterGas
  }
}
