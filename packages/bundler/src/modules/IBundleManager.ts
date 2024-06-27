import { BigNumber } from 'ethers'

export interface IBundleManager {

  sendNextBundle: () => Promise<any>

  handlePastEvents: () => Promise<any>

  getPaymasterBalance: (paymaster: string) => Promise<BigNumber>

}
