import { encodeUserOp, UserOperation } from '@account-abstraction/utils'
import { arrayify, hexDataLength, hexlify } from 'ethers/lib/utils'
import { bytesToHex } from '@ethereumjs/util'

export interface PreVerificationGasCalculatorConfig {
  /**
   * Cost of sending a basic transaction on the current chain.
   */
  readonly transactionGasStipend: number
  /**
   * Gas overhead is added to entire 'handleOp' bundle (on top of the transactionGasStipend).
   */
  readonly fixedGasOverhead: number
  /**
   * Gas overhead per UserOperation is added on top of the above fixed per-bundle.
   */
  readonly perUserOpGasOverhead: number

  /**
   * Gas overhead per single "word" (32 bytes) in callData.
   * (all validation fields are covered by verification gas checks)
   */
  readonly perUserOpWordGasOverhead: number
  /**
   * extra per-userop overhead, if callData starts with "executeUserOp" method signature.
   */
  readonly execUserOpGasOverhead: number
  /**
   * extra per-word overhead, if callData starts with "executeUserOp" method signature.
   */
  readonly execUserOpPerWordGasOverhead: number
  /**
   * The gas cost of a single zero byte an ABI-encoding of the UserOperation.
   */
  readonly zeroByteGasCost: number
  /**
   * The gas cost of a single zero byte an ABI-encoding of the UserOperation.
   */
  readonly nonZeroByteGasCost: number
  /**
   * The expected average size of a bundle in current network conditions.
   * This value is used to split the bundle gas overhead between all ops.
   */
  readonly expectedBundleSize: number
  /**
   * The size of the dummy 'signature' parameter to be used during estimation.
   */
  readonly estimationSignatureSize: number
  /**
   * The size of the dummy 'paymasterData' parameter to be used during estimation.
   */
  readonly estimationPaymasterDataSize: number
}

export const MainnetConfig: PreVerificationGasCalculatorConfig = {
  transactionGasStipend: 21000,
  fixedGasOverhead: 9830,
  perUserOpGasOverhead: 7260,
  execUserOpGasOverhead: 1610,
  perUserOpWordGasOverhead: 9.5,
  execUserOpPerWordGasOverhead: 8.2,
  zeroByteGasCost: 4,
  nonZeroByteGasCost: 16,
  expectedBundleSize: 1,
  estimationSignatureSize: 65,
  estimationPaymasterDataSize: 0
}

export const ChainConfigs: { [key: number]: PreVerificationGasCalculatorConfig } = {
  1: MainnetConfig,
  1337: MainnetConfig
}

export class PreVerificationGasCalculator {
  constructor (
    readonly config: PreVerificationGasCalculatorConfig
  ) {}

  /**
   * When accepting a UserOperation from a user to a mempool bundler validates the amount of 'preVerificationGas'.
   * If the proposed value is lower that the one expected by the bundler the UserOperation may not be profitable.
   * Notice that in order to participate in a P2P UserOperations mempool all bundlers must use the same configuration.
   * @param userOp - the complete and signed UserOperation received from the user.
   */
  validatePreVerificationGas (
    userOp: UserOperation
  ): { isPreVerificationGasValid: boolean, minRequiredPreVerificationGas: number } {
    const minRequiredPreVerificationGas = this._calculate(userOp)
    return {
      minRequiredPreVerificationGas,
      isPreVerificationGasValid: minRequiredPreVerificationGas <= parseInt((userOp.preVerificationGas as any).toString())
    }
  }

  /**
   * While filling the partial UserOperation bundler estimate the 'preVerificationGas' necessary for it to be accepted.
   * Value of the 'preVerificationGas' is the cost overhead that cannot be calculated precisely or accessed on-chain.
   * It depends on blockchain parameters that are defined by the protocol for all transactions.
   * @param userOp - the UserOperation object that may be missing the 'signature' and 'paymasterData' fields.
   */
  estimatePreVerificationGas (
    userOp: Partial<UserOperation>
  ): number {
    const filledUserOp = this._fillUserOpWithDummyData(userOp)
    return this._calculate(filledUserOp)
  }

  _calculate (userOp: UserOperation): number {
    const packedUserOp = arrayify(encodeUserOp(userOp, false))
    const userOpWordsLength = (packedUserOp.length + 31) / 32
    const callDataCost = packedUserOp
      .map(
        x => x === 0 ? this.config.zeroByteGasCost : this.config.nonZeroByteGasCost)
      .reduce(
        (sum, x) => sum + x
      )

    const userOpShareOfStipend = this.config.transactionGasStipend / this.config.expectedBundleSize
    let perWordOverhead = 0
    let callDataOverhead = 0
    let perUserOpOverhead = this.config.perUserOpGasOverhead
    if (bytesToHex(arrayify(userOp.callData)).startsWith('0x8dd7712f')) {
      perWordOverhead += this.config.execUserOpPerWordGasOverhead
      perUserOpOverhead += this.config.execUserOpGasOverhead
    } else {
      callDataOverhead += Math.ceil(hexDataLength(userOp.callData) / 32) * this.config.perUserOpWordGasOverhead
    }

    const userOpDataWordsOverhead = userOpWordsLength * perWordOverhead

    const userOpSpecificOverhead = callDataCost + userOpDataWordsOverhead + perUserOpOverhead + callDataOverhead
    const userOpShareOfBundleCost = this.config.fixedGasOverhead / this.config.expectedBundleSize

    return Math.round(userOpSpecificOverhead + userOpShareOfBundleCost + userOpShareOfStipend)
  }

  _fillUserOpWithDummyData (userOp: Partial<UserOperation>): UserOperation {
    const filledUserOp: UserOperation = Object.assign({}, userOp) as UserOperation
    filledUserOp.preVerificationGas = filledUserOp.preVerificationGas ?? 21000
    filledUserOp.signature = filledUserOp.signature ?? hexlify(Buffer.alloc(this.config.estimationSignatureSize, 0xff))
    filledUserOp.paymasterData = filledUserOp.paymasterData ?? hexlify(Buffer.alloc(this.config.estimationPaymasterDataSize, 0xff))
    return filledUserOp
  }
}
