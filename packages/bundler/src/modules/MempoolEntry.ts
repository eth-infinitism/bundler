import { BigNumber, BigNumberish } from 'ethers'
import { OperationBase, ReferencedCodeHashes, UserOperation } from '@account-abstraction/utils'
import { ERC7562Violation } from '@account-abstraction/validation-manager/dist/src/ERC7562Violation'
import { ValidateUserOpResult } from '@account-abstraction/validation-manager'

export class MempoolEntry {
  userOpMaxGas: BigNumber

  constructor (
    readonly userOp: OperationBase,
    readonly userOpHash: string,
    readonly validateUserOpResult: ValidateUserOpResult,
    readonly prefund: BigNumberish,
    readonly referencedContracts: ReferencedCodeHashes,
    readonly ruleViolations: ERC7562Violation[],
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
