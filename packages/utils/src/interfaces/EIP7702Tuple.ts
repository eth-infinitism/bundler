import { BigNumberish } from 'ethers'

export interface EIP7702Tuple {
  chainId: BigNumberish,
  address: string,
  nonce: BigNumberish,
  yParity: BigNumberish,
  r: BigNumberish,
  s: BigNumberish
}
