import { TransactionDetailsForUserOp } from './TransactionDetailsForUserOp'

/**
 * Base class for all Smart Wallet ERC-4337 Clients to implement.
 */
export class SmartWalletAPI {
  async getInitCode (): Promise<string> {
    return ''
  }

  async getNonce (): Promise<number> {
    return 0
  }

  async getVerificationGas (): Promise<number> {
    return 0
  }

  async getPreVerificationGas (): Promise<number> {
    return 0
  }

  /**
   * TBD: We are assuming there is only the Wallet that impacts the resulting CallData here.
   */
  async encodeUserOpCallData (detailsForUserOp: TransactionDetailsForUserOp): Promise<string> {
    // todo: for SimpleWallet this is encodeABI()
    return detailsForUserOp.target + detailsForUserOp.data + detailsForUserOp.value
  }

  async getSender (): Promise<string> {
    return ''
  }

  // tbd: not sure this is only dependant on Wallet, but callGas is the gas given to the Wallet, not just target
  async getCallGas (): Promise<number> {
    return 0
  }
}
