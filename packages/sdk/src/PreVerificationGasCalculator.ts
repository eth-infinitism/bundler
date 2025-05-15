import { encodeUserOp, UserOperation } from '@account-abstraction/utils'
import { arrayify, hexDataLength, hexlify } from 'ethers/lib/utils'
import { bytesToHex } from '@ethereumjs/util'
import { BigNumber, BytesLike } from 'ethers'

const EXECUTE_USEROP_METHOD_SIG = '0x8dd7712f'

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
  readonly executeUserOpGasOverhead: number
  /**
   * extra per-word overhead, if callData starts with "executeUserOp" method signature.
   */
  readonly executeUserOpPerWordGasOverhead: number
  /**
   * The gas cost of a single "token" (zero byte) of the ABI-encoded UserOperation.
   */
  readonly standardTokenGasCost: number

  /**
   * should we enable EIP-7623 gas-based calculation.
   */
  readonly useEip7623: boolean

  /**
   * The EIP-7623 floor gas cost of a single token.
   */
  readonly floorPerTokenGasCost: number

  /**
   * The number of non-zero bytes that are counted as a single token (EIP-7623).
   */
  readonly tokensPerNonzeroByte: number

  /**
   * gas cost of EIP-7702 authorization. PER_EMPTY_ACCOUNT_COST
   * (this amount is taken even if the account is already deployed)
   */
  readonly eip7702AuthGas: number
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

export interface GasOptions {
  /**
   * if set, assume this gas is actually used by verification of the UserOperation.
   * (as checked during UserOperation simulation)
   */
  verificationGasUsed?: number

  /**
   * if set, this is the gas used by the entire UserOperation - including verification and execution.
   * that is, ignore verificationGas and also the 10% penalty on execution gas.
   * This value is only used for testing purposes.
   * It can only be used reliably from a transaction receipt, after the transaction was executed.
   * Note that setting zero value here disables EIP-7623 gas calculation (it overrides taking both verificationGas and callGasLimit into account).
   */
  totalGasUsed?: number
}

export const MainnetConfig: PreVerificationGasCalculatorConfig = {
  transactionGasStipend: 21000,
  fixedGasOverhead: 9830,
  perUserOpGasOverhead: 7260,
  executeUserOpGasOverhead: 1610,
  perUserOpWordGasOverhead: 9.5,
  executeUserOpPerWordGasOverhead: 8.2,
  standardTokenGasCost: 4,
  useEip7623: true,
  floorPerTokenGasCost: 10,
  tokensPerNonzeroByte: 4,
  eip7702AuthGas: 25000,
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
   * @param gasOptions - apply EIP-7623 gas calculation.
   */
  validatePreVerificationGas (
    userOp: UserOperation,
    gasOptions: GasOptions
  ): { isPreVerificationGasValid: boolean, minRequiredPreVerificationGas: number } {
    const minRequiredPreVerificationGas = this._calculate(userOp, gasOptions)
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
   @param gasOptions - apply EIP-7623 gas calculation.
   */
  estimatePreVerificationGas (
    userOp: Partial<UserOperation>,
    gasOptions: GasOptions
  ): number {
    const filledUserOp = this._fillUserOpWithDummyData(userOp)
    return this._calculate(filledUserOp, gasOptions)
  }

  _calculate (userOp: UserOperation, gasOptions: GasOptions): number {
    const packedUserOp = arrayify(encodeUserOp(userOp, false))
    const userOpWordsLength = (packedUserOp.length + 31) / 32
    const tokenCount = this._countTokens(packedUserOp)

    let callDataOverhead = 0
    let perUserOpOverhead = this.config.perUserOpGasOverhead
    if (userOp.eip7702Auth != null) {
      perUserOpOverhead += this.config.eip7702AuthGas
    }

    if (bytesToHex(arrayify(userOp.callData)).startsWith(EXECUTE_USEROP_METHOD_SIG)) {
      perUserOpOverhead += this.config.executeUserOpGasOverhead +
          this.config.executeUserOpPerWordGasOverhead * userOpWordsLength
    } else {
      callDataOverhead += Math.ceil(hexDataLength(userOp.callData) / 32) * this.config.perUserOpWordGasOverhead
    }

    const userOpSpecificOverhead = perUserOpOverhead + callDataOverhead
    const userOpShareOfBundleCost = this.config.fixedGasOverhead / this.config.expectedBundleSize

    const userOpShareOfStipend = this.config.transactionGasStipend / this.config.expectedBundleSize

    if (this.config.useEip7623) {
      const calculatedGasUsed = this._getUserOpGasUsed(userOp, gasOptions)

      const preVerficationGas = this._eip7623transactionGasCost(
        userOpShareOfStipend,
        tokenCount,
        userOpShareOfBundleCost + userOpSpecificOverhead + calculatedGasUsed
      ) - calculatedGasUsed

      return preVerficationGas
    } else {
      // Not using EIP-7623
      return this.config.standardTokenGasCost * tokenCount +
        userOpShareOfStipend + userOpShareOfBundleCost + userOpSpecificOverhead
    }
  }

  // during testing, totalGasUsed passes in the entire transaction "gasUsed" (from the transaction receipt)
  // during validation, collect only the gas known to be paid: the actual validation and 10% of execution gas.
  _getUserOpGasUsed (userOp: UserOperation, gasOptions: GasOptions): number {
    if (gasOptions?.totalGasUsed != null) {
      return gasOptions.totalGasUsed
    }
    return BigNumber.from(userOp.callGasLimit ?? 0).add(userOp.paymasterPostOpGasLimit ?? 0).div(10)
      .add(gasOptions?.verificationGasUsed ?? 0).toNumber()
  }

  // Based on the formula in https://eips.ethereum.org/EIPS/eip-7623#specification
  _eip7623transactionGasCost (stipendGasCost: number, tokenGasCount: number, executionGasCost: number): number {
    return Math.round(
      stipendGasCost +
      Math.max(
        this.config.standardTokenGasCost * tokenGasCount +
        executionGasCost
        ,
        this.config.floorPerTokenGasCost * tokenGasCount
      ))
  }

  _countTokens (bytes: BytesLike): number {
    return arrayify(bytes).map(
      x => x === 0 ? 1 : this.config.tokensPerNonzeroByte
    ).reduce((sum, x) => sum + x)
  }

  _fillUserOpWithDummyData (userOp: Partial<UserOperation>): UserOperation {
    const filledUserOp: UserOperation = Object.assign({}, userOp) as UserOperation
    filledUserOp.preVerificationGas = filledUserOp.preVerificationGas ?? 21000
    filledUserOp.signature = filledUserOp.signature ?? hexlify(Buffer.alloc(this.config.estimationSignatureSize, 0xff))
    filledUserOp.paymasterData = filledUserOp.paymasterData ?? hexlify(Buffer.alloc(this.config.estimationPaymasterDataSize, 0xff))
    return filledUserOp
  }
}
