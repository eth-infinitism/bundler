export interface IWalletInteractor {
  readNonce (): Promise<number>;
}
