import { BigNumberish } from 'ethers'
import { OperationBase } from './OperationBase'

export interface UserOperation extends OperationBase {
  nonce: BigNumberish
  preVerificationGas: BigNumberish
}
