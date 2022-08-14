import { ethers } from 'ethers'

export class PaymasterAPI {
  async getPaymasterData (): Promise<string> {
    return '0x'
  }

  async getPaymasterAddress (): Promise<string> {
    return ethers.constants.AddressZero
  }
}
