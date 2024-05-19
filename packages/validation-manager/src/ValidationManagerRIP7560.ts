import {
  OperationBase,
  getRIP7560TransactionHash, OperationRIP7560
} from '@account-abstraction/utils'
import { IValidationManager, ValidateUserOpResult } from './IValidationManager'

export class ValidationManagerRIP7560 implements IValidationManager {
  validateInputParameters (_operation: OperationBase, _entryPointInput?: string): void {
    // TODO
  }

  async validateUserOp (_userOp: OperationBase): Promise<ValidateUserOpResult> {
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

  async getOperationHash (operation: OperationBase): Promise<string> {
    return getRIP7560TransactionHash(operation as OperationRIP7560)
  }
}
