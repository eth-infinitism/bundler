import { BaseOperation, ReferencedCodeHashes, StakeInfo, StorageMap } from '@account-abstraction/utils'
import { BigNumberish } from 'ethers'

/**
 * result from successful simulateValidation, after some parsing.
 * TODO: does not exactly fit RIP-7560: preOpGas is always 0; "prefund" should be called "Max Charge" or something
 */
export interface ValidationResult {
  returnInfo: {
    preOpGas: BigNumberish
    prefund: BigNumberish
    sigFailed: boolean
    validAfter: number
    validUntil: number
  }

  senderInfo: StakeInfo
  factoryInfo?: StakeInfo
  paymasterInfo?: StakeInfo
  aggregatorInfo?: StakeInfo
}

export interface ValidateUserOpResult extends ValidationResult {
  referencedContracts: ReferencedCodeHashes
  storageMap: StorageMap
}

export interface IValidationManager {

  validateInputParameters: (operation: BaseOperation, entryPointInput?: string, requireSignature?: boolean, requireGasParams?: boolean) => void

  validateOperation: (userOp: BaseOperation, previousCodeHashes?: ReferencedCodeHashes, checkStakes?: boolean) => Promise<ValidateUserOpResult>

  getOperationHash: (userOp: BaseOperation) => Promise<string>

}
