import { AddressLike, BigNumberish } from 'ethers'

export interface TransactionDetailsForUserOp {
  target: AddressLike
  data: string
  value?: BigNumberish
  gasLimit?: BigNumberish
  maxFeePerGas?: BigNumberish
  maxPriorityFeePerGas?: BigNumberish
  nonce?: BigNumberish
}
