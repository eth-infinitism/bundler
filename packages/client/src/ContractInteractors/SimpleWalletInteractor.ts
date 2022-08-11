import { IWalletInteractor } from './IWalletInteractor'

export class SimpleWalletInteractor implements IWalletInteractor {
  async readNonce (): Promise<number> {
    return 0
  }
}
