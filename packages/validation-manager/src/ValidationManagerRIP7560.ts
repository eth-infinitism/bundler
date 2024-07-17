import { JsonRpcProvider } from '@ethersproject/providers'

import {
  AddressZero,
  OperationBase,
  OperationRIP7560,
  ReferencedCodeHashes,
  getRIP7560TransactionHash
} from '@account-abstraction/utils'

import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { debug_traceRip7560Validation } from './GethTracer'
import { tracerResultParser } from './TracerResultParser'

export class ValidationManagerRIP7560 implements IValidationManager {
  constructor (
    readonly provider: JsonRpcProvider,
    readonly unsafe: boolean
  ) {
  }

  validateInputParameters (_operation: OperationBase, _entryPointInput?: string): void {
    // TODO
  }

  async validateUserOp (operation: OperationBase, previousCodeHashes?: ReferencedCodeHashes): Promise<ValidateUserOpResult> {
    const transaction = operation as OperationRIP7560
    // let storageMap: StorageMap = {}
    // let codeHashes: ReferencedCodeHashes = {
    //   addresses: [],
    //   hash: ''
    // }
    if (!this.unsafe) {
      const traceResult = await this.traceValidation(transaction).catch(e => {
        throw e
      })
      // TODO alex shahaf add staked entities support
      const validationResult: ValidationResult = {
        returnInfo: { sigFailed: false, validAfter: 0, validUntil: 0 },
        factoryInfo: { stake: 0, addr: '', unstakeDelaySec: 0 },
        paymasterInfo: { stake: 0, addr: '', unstakeDelaySec: 0 },
        senderInfo: { stake: 0, addr: '', unstakeDelaySec: 0 }
      }
      console.log(JSON.stringify(traceResult))
      // this.parseValidationTracingResult(traceResult)
      // let contractAddresses: string[]
      // [contractAddresses, storageMap] =
      tracerResultParser(operation, traceResult, validationResult, AddressZero)
      // TODO alex shahaf handle codehashes
      // if no previous contract hashes, then calculate hashes of contracts
      if (previousCodeHashes == null) {
        // codeHashes = await this.getCodeHashes(contractAddresses)
      }
    } else {
      // NOTE: this mode doesn't do any opcode checking and no stake checking!
    }
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

  async traceValidation (transaction: OperationRIP7560): Promise<any> {
    return await debug_traceRip7560Validation(this.provider, transaction)
  }
}
