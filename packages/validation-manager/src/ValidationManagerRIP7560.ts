import { JsonRpcProvider } from '@ethersproject/providers'

import {
  OperationBase,
  OperationRIP7560,
  ReferencedCodeHashes,
  getRIP7560TransactionHash, IStakeManager, StakeInfo
} from '@account-abstraction/utils'

import { IValidationManager, ValidateUserOpResult, ValidationResult } from './IValidationManager'
import { eth_traceRip7560Validation } from './GethTracer'
import { tracerResultParser } from './TracerResultParser'
import debug from 'debug'
import { isAddress } from 'ethers/lib/utils'

export const AA_ENTRY_POINT = '0x0000000000000000000000000000000000007560'
export const AA_STAKE_MANAGER = '0x5271A07b4516A6408E27395941b3D8FC04d96353'

export class ValidationManagerRIP7560 implements IValidationManager {
  constructor (
    readonly stakeManager: IStakeManager,
    readonly provider: JsonRpcProvider,
    readonly unsafe: boolean
  ) {
  }

  validateInputParameters (_operation: OperationBase, _entryPointInput?: string): void {
    // TODO
  }

  async _getStakesInfo (operation: OperationBase): Promise<{ senderInfo: StakeInfo, paymasterInfo: StakeInfo, factoryInfo: StakeInfo }> {
    const senderTMI = await this.stakeManager.getDepositInfo(operation.sender)
    const senderInfo = {
      addr: operation.sender,
      ...senderTMI
    }
    let paymasterInfo: StakeInfo = {
      addr: '',
      stake: 0,
      unstakeDelaySec: 0
    }
    if (operation.paymaster != null && isAddress(operation.paymaster)) {
      const paymasterTMI = await this.stakeManager.getDepositInfo(operation.paymaster)
      paymasterInfo = {
        addr: operation.paymaster,
        ...paymasterTMI
      }
    }
    let factoryInfo: StakeInfo = {
      addr: '',
      stake: 0,
      unstakeDelaySec: 0
    }
    if (operation.factory != null && isAddress(operation.factory)) {
      const factoryTMI = await this.stakeManager.getDepositInfo(operation.factory)
      factoryInfo = {
        addr: operation.factory,
        ...factoryTMI
      }
    }
    return {
      factoryInfo,
      paymasterInfo,
      senderInfo
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
