import { BigNumber, BigNumberish } from 'ethers'
import { EIP7702Tuple, OperationBase, ReferencedCodeHashes, UserOperation } from '@account-abstraction/utils'

export class MempoolEntry {
  userOpMaxGas: BigNumber

  constructor (
    readonly userOp: OperationBase,
    readonly userOpHash: string,
    readonly eip7702Tuples: EIP7702Tuple[],
    readonly prefund: BigNumberish,
    readonly referencedContracts: ReferencedCodeHashes,
    readonly skipValidation: boolean,
    readonly aggregator?: string
  ) {
    this.userOpMaxGas = BigNumber
      .from((this.userOp as UserOperation).preVerificationGas ?? 0)
      .add(this.userOp.callGasLimit)
      .add(this.userOp.verificationGasLimit)
      .add(this.userOp.paymasterVerificationGasLimit ?? 0)
      .add(this.userOp.paymasterPostOpGasLimit ?? 0)
  }
}
