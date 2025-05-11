import debug from 'debug'
import { BigNumber, BigNumberish, Signer } from 'ethers'
import { EventFragment } from '@ethersproject/abi'
import { JsonRpcProvider, Log } from '@ethersproject/providers'
import { toNumber } from '@nomicfoundation/hardhat-network-helpers/dist/src/utils'

import { MainnetConfig, PreVerificationGasCalculator } from '@account-abstraction/sdk'

import {
  AddressZero,
  EIP_7702_MARKER_INIT_CODE,
  IEntryPoint,
  PackedUserOperation,
  RpcError,
  UserOperation,
  UserOperationEventEvent,
  ValidationErrors,
  callGetUserOpHashWithCode,
  decodeRevertReason,
  decodeSimulateHandleOpResult,
  deepHexlify,
  erc4337RuntimeVersion,
  getAuthorizationList,
  mergeValidationDataValues,
  requireAddressAndFields,
  requireCond,
  simulationRpcParams,
  tostr,
  unpackUserOp
} from '@account-abstraction/utils'
import { BundlerConfig } from './BundlerConfig'

import { ExecutionManager } from './modules/ExecutionManager'
import { StateOverride, UserOperationByHashResponse, UserOperationReceipt } from './RpcTypes'

export const HEX_REGEX = /^0x[a-fA-F\d]*$/i

/**
 * return value from estimateUserOpGas
 */
export interface EstimateUserOpGasResult {
  /**
   * the preVerification gas used by this UserOperation.
   */
  preVerificationGas: BigNumberish
  /**
   * gas used for validation of this UserOperation, including account creation
   */
  verificationGasLimit: BigNumberish

  /**
   * (possibly future timestamp) after which this UserOperation is valid
   */
  validAfter?: BigNumberish

  /**
   * the deadline after which this UserOperation is invalid (not a gas estimation parameter, but returned by validation
   */
  validUntil?: BigNumberish
  /**
   * estimated cost of calling the account with the given callData
   */
  callGasLimit: BigNumberish
}

export class MethodHandlerERC4337 {
  constructor (
    readonly execManager: ExecutionManager,
    readonly provider: JsonRpcProvider,
    readonly signer: Signer,
    readonly config: BundlerConfig,
    readonly entryPoint: IEntryPoint,
    public preVerificationGasCalculator: PreVerificationGasCalculator
  ) {
  }

  async getSupportedEntryPoints (): Promise<string[]> {
    return [this.config.entryPoint]
  }

  async selectBeneficiary (): Promise<string> {
    const currentBalance = await this.provider.getBalance(this.signer.getAddress())
    let beneficiary = this.config.beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(this.config.minBalance)) {
      beneficiary = await this.signer.getAddress()
      console.log('low balance. using ', beneficiary, 'as beneficiary instead of ', this.config.beneficiary)
    }
    return beneficiary
  }

  async _validateParameters (userOp1: UserOperation, entryPointInput: string, requireSignature = true, requireGasParams = true): Promise<void> {
    requireCond(entryPointInput != null, 'No entryPoint param', -32602)

    if (entryPointInput?.toString().toLowerCase() !== this.config.entryPoint.toLowerCase()) {
      throw new Error(`The EntryPoint at "${entryPointInput}" is not supported. This bundler uses ${this.config.entryPoint}`)
    }
    // minimal sanity check: userOp exists, and all members are hex
    requireCond(userOp1 != null, 'No UserOperation param', ValidationErrors.InvalidFields)
    const userOp = userOp1 as any

    const fields = ['sender', 'nonce', 'callData']
    if (requireSignature) {
      fields.push('signature')
    }
    if (requireGasParams) {
      fields.push('preVerificationGas', 'verificationGasLimit', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas')
    }
    fields.forEach(key => {
      requireCond(userOp[key] != null, 'Missing userOp field: ' + key, -32602)
      const value: string = userOp[key].toString()
      requireCond(value.match(HEX_REGEX) != null, `Invalid hex value for property ${key}:${value} in UserOp`, -32602)
    })
    requireAddressAndFields(userOp, 'paymaster', ['paymasterPostOpGasLimit', 'paymasterVerificationGasLimit'], ['paymasterData'])
    if (userOp1.factory !== EIP_7702_MARKER_INIT_CODE) {
      requireAddressAndFields(userOp, 'factory', ['factoryData'])
    }
  }

  /**
   * eth_estimateUserOperationGas RPC api.
   * @param userOp1 input userOp (may have gas fields missing, so they can be estimated)
   * @param entryPointInput
   * @param stateOverride
   */
  async estimateUserOperationGas (
    userOp1: Partial<UserOperation>,
    entryPointInput: string,
    stateOverride?: StateOverride
  ): Promise<EstimateUserOpGasResult> {
    if (!this.config.eip7702Support && userOp1.eip7702Auth != null) {
      throw new Error('EIP-7702 tuples are not supported')
    }
    const userOp: UserOperation = {
      // default values for missing fields.
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      preVerificationGas: 0,
      verificationGasLimit: 10e6,
      ...userOp1
    } as any
    // todo: checks the existence of parameters, but since we hexlify the inputs, it fails to validate
    await this._validateParameters(deepHexlify(userOp), entryPointInput)
    // todo: validation manager duplicate?
    const provider = this.provider
    const rpcParams = simulationRpcParams('simulateHandleOp', this.entryPoint.address, userOp, [AddressZero, '0x'],
      stateOverride
      // {
      // allow estimation when account's balance is zero.
      // todo: need a way to flag this, and not enable always.
      // [userOp.sender]: {
      //   balance: hexStripZeros(parseEther('1').toHexString())
      // }
      // }
    )
    const ret = await provider.send('eth_call', rpcParams)
      .catch((e: any) => { throw new RpcError(decodeRevertReason(e) as string, ValidationErrors.SimulateValidation) })

    const returnInfo = decodeSimulateHandleOpResult(ret)

    const {
      validAfter,
      validUntil
    } = mergeValidationDataValues(returnInfo.accountValidationData, returnInfo.paymasterValidationData)
    const {
      preOpGas
    } = returnInfo

    const authorizationList = getAuthorizationList(userOp)
    // todo: use simulateHandleOp for this too...
    let callGasLimit = await this.provider.send(
      'eth_estimateGas', [
        {
          from: this.entryPoint.address,
          to: userOp.sender,
          data: userOp.callData,
          // @ts-ignore
          authorizationList: authorizationList.length === 0 ? null : authorizationList
        }
      ]
    ).then(b => toNumber(b)).catch(err => {
      const message = err.message.match(/reason="(.*?)"/)?.at(1) ?? 'execution reverted'
      throw new RpcError(message, ValidationErrors.UserOperationReverted)
    })
    // Results from 'estimateGas' assume making a standalone transaction and paying 21'000 gas extra for it
    callGasLimit -= MainnetConfig.transactionGasStipend

    const preVerificationGas = this.preVerificationGasCalculator.estimatePreVerificationGas(userOp, {})
    const verificationGasLimit = BigNumber.from(preOpGas).toNumber()
    return {
      preVerificationGas,
      verificationGasLimit,
      validAfter,
      validUntil,
      callGasLimit
    }
  }

  async sendUserOperation (userOp: UserOperation, entryPointInput: string): Promise<string> {
    if (!this.config.eip7702Support && userOp.eip7702Auth != null) {
      throw new Error('EIP-7702 tuples are not supported')
    }
    await this._validateParameters(userOp, entryPointInput)

    debug(`UserOperation: Sender=${userOp.sender}  Nonce=${tostr(userOp.nonce)} EntryPoint=${entryPointInput} Paymaster=${userOp.paymaster ?? ''} ${userOp.eip7702Auth != null ? 'eip-7702 auth' : ''}`)
    await this.execManager.sendUserOperation(userOp, entryPointInput, false)
    return await callGetUserOpHashWithCode(this.entryPoint, userOp)
  }

  async _getUserOperationEvent (userOpHash: string): Promise<UserOperationEventEvent> {
    // TODO: eth_getLogs is throttled. must be acceptable for finding a UserOperation by hash
    const event = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationEvent(userOpHash))
    return event[0]
  }

  // filter full bundle logs, and leave only logs for the given userOpHash
  // @param userOpEvent - the event of our UserOp (known to exist in the logs)
  // @param logs - full bundle logs. after each group of logs there is a single UserOperationEvent with unique hash.
  _filterLogs (userOpEvent: UserOperationEventEvent, logs: Log[]): Log[] {
    let startIndex = -1
    let endIndex = -1
    const events = Object.values(this.entryPoint.interface.events)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const beforeExecutionTopic = this.entryPoint.interface.getEventTopic(events.find((e: EventFragment) => e.name === 'BeforeExecution')!)
    logs.forEach((log, index) => {
      if (log?.topics[0] === beforeExecutionTopic) {
        // all UserOp execution events start after the "BeforeExecution" event.
        startIndex = endIndex = index
      } else if (log?.topics[0] === userOpEvent.topics[0]) {
        // process UserOperationEvent
        if (log.topics[1] === userOpEvent.topics[1]) {
          // it's our userOpHash. save as end of logs array
          endIndex = index
        } else {
          // it's a different hash. remember it as beginning index, but only if we didn't find our end index yet.
          if (endIndex === -1) {
            startIndex = index
          }
        }
      }
    })
    if (endIndex === -1) {
      throw new Error('fatal: no UserOperationEvent in logs')
    }
    return logs.slice(startIndex + 1, endIndex)
  }

  async getUserOperationByHash (userOpHash: string): Promise<UserOperationByHashResponse | null> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32602)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const tx = await event.getTransaction()
    if (tx.to !== this.entryPoint.address) {
      throw new Error('unable to parse transaction')
    }
    const parsed = this.entryPoint.interface.parseTransaction(tx)
    const ops: PackedUserOperation[] = parsed?.args.ops
    if (ops == null) {
      throw new Error('failed to parse transaction')
    }
    const op = ops.find(op =>
      op.sender === event.args.sender &&
      BigNumber.from(op.nonce).eq(event.args.nonce)
    )
    if (op == null) {
      throw new Error('unable to find userOp in transaction')
    }

    return deepHexlify({
      userOperation: unpackUserOp(op),
      entryPoint: this.entryPoint.address,
      transactionHash: tx.hash,
      blockHash: tx.blockHash ?? '',
      blockNumber: tx.blockNumber ?? 0
    })
  }

  async getUserOperationReceipt (userOpHash: string): Promise<UserOperationReceipt | null> {
    requireCond(userOpHash?.toString()?.match(HEX_REGEX) != null, 'Missing/invalid userOpHash', -32602)
    const event = await this._getUserOperationEvent(userOpHash)
    if (event == null) {
      return null
    }
    const receipt = await event.getTransactionReceipt()
    const logs = this._filterLogs(event, receipt.logs)
    return deepHexlify({
      userOpHash,
      sender: event.args.sender,
      nonce: event.args.nonce,
      actualGasCost: event.args.actualGasCost,
      actualGasUsed: event.args.actualGasUsed,
      success: event.args.success,
      logs,
      receipt
    })
  }

  clientVersion (): string {
    // eslint-disable-next-line
    return 'aa-bundler/' + erc4337RuntimeVersion + (this.config.unsafe ? '/unsafe' : '')
  }
}
