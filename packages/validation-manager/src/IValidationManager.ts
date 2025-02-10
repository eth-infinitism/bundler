import { BigNumber, BigNumberish } from 'ethers'

import {
  IEntryPoint,
  OperationBase,
  ReferencedCodeHashes,
  StakeInfo,
  StorageMap
} from '@account-abstraction/utils'
import { PreVerificationGasCalculatorConfig } from '@account-abstraction/sdk'
import { ERC7562Violation } from './ERC7562Violation'

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
  ruleViolations: ERC7562Violation[]
  referencedContracts: ReferencedCodeHashes
  storageMap: StorageMap
}

export const EmptyValidateUserOpResult: ValidateUserOpResult = {
  returnInfo: {
    preOpGas: BigNumber.from(0),
    prefund: BigNumber.from(0),
    sigFailed: false,
    validAfter: 0,
    validUntil: 0
  },
  senderInfo: {
    addr: '',
    stake: '0',
    unstakeDelaySec: 0
  },
  referencedContracts: {
    addresses: [],
    hash: ''
  },
  ruleViolations: [],
  storageMap: {}
}

export interface IValidationManager {

  validateInputParameters: (operation: OperationBase, entryPointInput?: string, requireSignature?: boolean, requireGasParams?: boolean) => void

  validateUserOp: (userOp: OperationBase, previousCodeHashes?: ReferencedCodeHashes, checkStakes?: boolean) => Promise<ValidateUserOpResult>

  getOperationHash: (userOp: OperationBase) => Promise<string>

  _getDebugConfiguration: () => {
    configuration: PreVerificationGasCalculatorConfig
    entryPoint: IEntryPoint
    unsafe: boolean
  }
}
