import { BigNumberish, BytesLike } from 'ethers'
import { OperationBase } from './OperationBase'

export interface UserOperation extends OperationBase {
  // these fields have same meaning but different names between ERC-4337 and RIP-7560/RIP-7712
  callData: BytesLike
  signature: BytesLike
  nonce: BigNumberish

  preVerificationGas: BigNumberish
}
