import { JsonRpcProvider } from '@ethersproject/providers'

import {
  OperationBase,
  OperationRIP7560,
  getRIP7560TransactionHash, RpcError, ValidationErrors
} from '@account-abstraction/utils'

import { BundlerTracerResult } from './BundlerCollectorTracer'
import { IValidationManager, ValidateUserOpResult } from './IValidationManager'
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

  async validateUserOp (operation: OperationBase): Promise<ValidateUserOpResult> {
    const transaction = operation as OperationRIP7560
    if (!this.unsafe) {
      const result = await this.traceValidation(transaction).catch(e => {
        throw e
      })
      console.log(JSON.stringify(result))
      this.parseValidationTracingResult(result)
      // let contractAddresses: string[]
      // [contractAddresses, storageMap] = tracerResultParser(userOp, tracerResult, res, this.entryPoint)
      // if no previous contract hashes, then calculate hashes of contracts
      // if (previousCodeHashes == null) {
      //   codeHashes = await this.getCodeHashes(contractAddresses)
      // }
      // if (res as any === '0x') {
      //   throw new Error('simulateValidation reverted with no revert string!')
      // }
    } else {
      // NOTE: this mode doesn't do any opcode checking and no stake checking!
      // res = await this._callSimulateValidation(userOp)
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

  parseValidationTracingResult (result: any): void {
    if (result.calls_from_entry_point[0]['opcodes']['TIMESTAMP']) {
      throw new RpcError("Forbidden opcode RIP-7560", ValidationErrors.OpcodeValidation)
    }
  }
}
