import { OperationBase } from './OperationBase'
import { BigNumberish } from 'ethers'

export interface OperationRIP7560 extends OperationBase {
  chainId: BigNumberish
  accessList: any
  value: BigNumberish
  builderFee: BigNumberish
  bigNonce: BigNumberish
}
