import { BigNumberish, BytesLike } from 'ethers'

import { EIP7702Authorization } from './EIP7702Authorization'

/**
 * The operation interface that is shared by ERC-4337 and RIP-7560 types.
 */
export interface OperationBase {
  sender: string
  nonce: BigNumberish

  factory?: string
  factoryData?: BytesLike

  paymaster?: string
  paymasterData?: BytesLike

  maxFeePerGas: BigNumberish
  maxPriorityFeePerGas: BigNumberish

  callGasLimit: BigNumberish
  verificationGasLimit: BigNumberish
  paymasterVerificationGasLimit?: BigNumberish
  paymasterPostOpGasLimit?: BigNumberish
}
