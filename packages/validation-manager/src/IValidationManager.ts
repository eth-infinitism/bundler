import { OperationBase, ReferencedCodeHashes, StakeInfo, StorageMap } from '@account-abstraction/utils'
import { BigNumberish } from 'ethers'

/**
 * result from successful validation
 */
export interface ValidationResult {
  returnInfo: {
    preOpGas?: BigNumberish
    prefund?: BigNumberish
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

  validateInputParameters: (operation: OperationBase, entryPointInput?: string, requireSignature?: boolean, requireGasParams?: boolean) => void

  validateUserOp: (userOp: OperationBase, previousCodeHashes?: ReferencedCodeHashes, checkStakes?: boolean) => Promise<ValidateUserOpResult>

  getOperationHash: (userOp: OperationBase) => Promise<string>

}
