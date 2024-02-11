import {
  BaseOperation,
  RIP7560Transaction,
  ReferencedCodeHashes,
  getRIP7560TransactionHash
} from '@account-abstraction/utils'
import { IValidationManager, ValidateUserOpResult } from './IValidationManager'

export class RIP7560ValidationManager implements IValidationManager {
  validateInputParameters (operation: BaseOperation, entryPointInput: string): void {
    // throw new Error('Method not implemented.');
  }

  async validateOperation (userOp: BaseOperation, previousCodeHashes?: ReferencedCodeHashes | undefined): Promise<ValidateUserOpResult> {
    return {
      returnInfo: {
        preOpGas: 0,
        prefund: 0,
        sigFailed: false,
        validAfter: 0,
        validUntil: 0
      },
      senderInfo: {
        addr: '',
        stake: 0,
        unstakeDelaySec: 0
      },
      referencedContracts: {
        addresses: [],
        hash: ''
      },
      storageMap: {}
    }
    // throw new Error('Method not implemented.');
  }

  async getOperationHash (operation: BaseOperation): Promise<string> {
    return getRIP7560TransactionHash(operation as RIP7560Transaction)
  }
}
