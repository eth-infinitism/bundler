import { JsonRpcProvider } from '@ethersproject/providers'

import {
  OperationBase,
  OperationRIP7560,
  ReferencedCodeHashes,
  getRIP7560TransactionHash, StakeInfo
} from '@account-abstraction/utils'

import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { eth_traceRip7560Validation } from './GethTracer'
import { tracerResultParser } from './TracerResultParser'
import debug from 'debug'
import { isAddress } from 'ethers/lib/utils'
import { IRip7560StakeManager } from '@account-abstraction/utils/dist/src/types'

export const AA_ENTRY_POINT = '0x0000000000000000000000000000000000007560'
export const AA_STAKE_MANAGER = '0x570Aa568b6cf62ff08c6C3a3b3DB1a0438E871Fb'

export class ValidationManagerRIP7560 implements IValidationManager {
  constructor (
    readonly stakeManager: IRip7560StakeManager,
    readonly provider: JsonRpcProvider,
    readonly unsafe: boolean
  ) {
  }

  validateInputParameters (_operation: OperationBase, _entryPointInput?: string): void {
    // TODO
  }

  async _getStakesInfo (operation: OperationBase): Promise<{ senderInfo: StakeInfo, paymasterInfo?: StakeInfo, factoryInfo?: StakeInfo }> {
    const addresses = [operation.sender]
    let paymasterInfo, factoryInfo
    if (operation.paymaster != null && isAddress(operation.paymaster)) {
      addresses.push(operation.paymaster)
    }
    if (operation.factory != null && isAddress(operation.factory)) {
      addresses.push(operation.factory)
    }
    const stakesInfo = await this.stakeManager.getStakeInfo(addresses)
    const senderInfo = {
      addr: operation.sender,
      ...stakesInfo[0]
    }
    if (operation.paymaster != null && isAddress(operation.paymaster)) {
      paymasterInfo = {
        addr: operation.paymaster,
        ...stakesInfo[1]
      }
    }
    if (operation.factory != null && isAddress(operation.factory)) {
      factoryInfo = {
        addr: operation.factory,
        ...stakesInfo[addresses.length - 1]
      }
    }

    return {
      senderInfo,
      factoryInfo,
      paymasterInfo
    }
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
      const stakesInfo = await this._getStakesInfo(operation)
      const validationResult: ValidationResult = {
        returnInfo: { sigFailed: false, validAfter: 0, validUntil: 0 },
        ...stakesInfo
      }
      debug(`traceResult= ${JSON.stringify(traceResult)}`)
      // this.parseValidationTracingResult(traceResult)
      // let contractAddresses: string[]
      // [contractAddresses, storageMap] =
      tracerResultParser(operation, traceResult, validationResult, AA_ENTRY_POINT)
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
    return await eth_traceRip7560Validation(this.provider, transaction)
  }
}
