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
}
