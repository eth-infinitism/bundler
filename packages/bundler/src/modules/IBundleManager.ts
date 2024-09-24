import { BigNumber, BigNumberish } from 'ethers'

import { EIP7702Authorization, OperationBase, StorageMap } from '@account-abstraction/utils'

export interface IBundleManager {

  sendNextBundle: () => Promise<any>

  handlePastEvents: () => Promise<any>

  getPaymasterBalance: (paymaster: string) => Promise<BigNumber>

  createBundle: (
    minBaseFee: BigNumberish,
    maxBundleGas: BigNumberish,
    maxBundleSize: BigNumberish
  ) => Promise<[OperationBase[], EIP7702Authorization[], StorageMap]>
}
