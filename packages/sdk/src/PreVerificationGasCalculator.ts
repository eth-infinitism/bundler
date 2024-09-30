import { encodeUserOp, packUserOp, UserOperation } from '@account-abstraction/utils'
import { arrayify, hexlify } from 'ethers/lib/utils'
import { BigNumber, BigNumberish } from 'ethers'

// export const DefaultGasOverheads: GasOverheads = {
//   fixed: 21000,
//   perUserOp: 18300,
//   perUserOpWord: 4,
//   zeroByte: 4,
//   nonZeroByte: 16,
//   bundleSize: 1,
//   sigSize: 65
// }

export class PreVerificationGasCalculator {
  constructor (
    /**
     * Gas overhead is added to entire 'handleOp' bundle.
     */
    readonly fixedGasOverhead: number,
    /**
     * Gas overhead per UserOperation is added on top of the above fixed per-bundle.
     */
    readonly perUserOpGasOverhead: number,
    /**
     * Gas overhead per single "word" (32 bytes) of an ABI-encoding of the UserOperation.
     */
    readonly perUserOpWordGasOverhead: number,
    /**
     * The gas cost of a single zero byte an ABI-encoding of the UserOperation.
     */
    readonly zeroByteGasCost: number,
    /**
     * The gas cost of a single zero byte an ABI-encoding of the UserOperation.
     */
    readonly nonZeroByteGasCost: number,
    /**
     * The expected average size of a bundle in current network conditions.
     * This value is used to split the bundle gas overhead between all ops.
     */
    readonly expectedBundleSize: number,
    /**
     * The size of the dummy 'signature' parameter to be used during estimation.
     */
    readonly estimationSignatureSize: number,
    /**
     * The size of the dummy 'paymasterData' parameter to be used during estimation.
     */
    readonly estimationPaymasterDataSize: number = 0
  ) {}

  validatePreVerificationGas (
    userOp: UserOperation, preVerificationGas: BigNumberish
  ): { isPreVerificationGasValid: boolean, minRequiredPreVerificationGas: number } {
    return { isPreVerificationGasValid: false, minRequiredPreVerificationGas: 0 }
  }

  /**
   * Estimate the 'preVerificationGas' necessary for the given UserOperation.
   * Value of the 'preVerificationGas' is the cost overhead that cannot be calculated precisely or accessed on-chain.
   * It depends on blockchain parameters that are defined by the protocol for all transactions.
   * @param userOp - the UserOperation object that may be missing the 'signature' and 'paymasterData' fields.
   */
  estimatePreVerificationGas (
    userOp: Partial<UserOperation>
  ): number {
    const filledUserOp = this._fillUserOpWithDummyData(userOp)
    const packedUserOp = arrayify(encodeUserOp(packUserOp(filledUserOp), false))
    const userOpWordsLength = (packedUserOp.length + 31) / 32
    const callDataCost = packedUserOp
      .map(
        x => x === 0 ? this.zeroByteGasCost : this.nonZeroByteGasCost)
      .reduce(
        (sum, x) => sum + x
      )
    const userOpDataWordsOverhead = userOpWordsLength * this.perUserOpWordGasOverhead

    const userOpSpecificOverhead = callDataCost + userOpDataWordsOverhead + this.perUserOpGasOverhead
    const userOpShareOfBundleCost = this.fixedGasOverhead / this.expectedBundleSize

    return Math.round(userOpSpecificOverhead + userOpShareOfBundleCost)
  }

  _fillUserOpWithDummyData (userOp: Partial<UserOperation>): UserOperation {
    const filledUserOp: UserOperation = Object.assign({}, userOp) as UserOperation
    filledUserOp.preVerificationGas = 21000 // dummy value
    filledUserOp.signature = hexlify(Buffer.alloc(this.estimationSignatureSize, 0xff))
    filledUserOp.paymasterData = hexlify(Buffer.alloc(this.estimationPaymasterDataSize, 0xff))
    return filledUserOp
  }
}
