import { OperationBase } from './OperationBase'
import { BigNumberish, BytesLike } from 'ethers'
import { EIP7702Tuple } from './EIP7702Tuple'

export interface OperationRIP7560 extends OperationBase {
  chainId: BigNumberish
  accessList: any
  value: BigNumberish
  builderFee: BigNumberish

  executionData: BytesLike
  authorizationData: BytesLike

  // todo: we discussed using 'nonceKey' in the JSON schema for ERC-4337 as well but we did not finalize this decision
  nonceKey: BigNumberish

  // note that for RIP-7560 the EIP-7702 tuples are part of a transaction JSON object
  eip7702Tuples: EIP7702Tuple[]
}
