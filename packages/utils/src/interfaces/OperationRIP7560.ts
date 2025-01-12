import { OperationBase } from './OperationBase'
import { BigNumberish, BytesLike } from 'ethers'
import { EIP7702Authorization } from './EIP7702Authorization'

export interface OperationRIP7560 extends OperationBase {
  chainId: BigNumberish
  accessList: any
  value: BigNumberish
  builderFee: BigNumberish

  executionData: BytesLike
  authorizationData: BytesLike

  // todo: we discussed using 'nonceKey' in the JSON schema for ERC-4337 as well but we did not finalize this decision
  nonceKey: BigNumberish

  authorizationList?: EIP7702Authorization[]
}
