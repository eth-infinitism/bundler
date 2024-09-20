import { BigNumberish } from 'ethers'

export interface EIP7702Tuple {
  chainId: BigNumberish,
  address: string,
  nonce: BigNumberish,
  yParity: BigNumberish,
  r: BigNumberish,
  s: BigNumberish
}

export function getEip7702TupleSigner (tuple: EIP7702Tuple): string {
  throw new Error('Not implemented')
}
