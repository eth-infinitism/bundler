import { BigNumber } from 'ethers'
import { FunctionFragment, hexZeroPad, Interface } from 'ethers/lib/utils'

import {
  AddressZero,
  IEntryPoint__factory,
  IPaymaster__factory,
  OperationBase,
  RpcError,
  SenderCreator__factory,
  StakeInfo,
  StorageMap,
  ValidationErrors
} from '@account-abstraction/utils'

import { ERC7562Violation, toError } from './ERC7562Violation'
import { ERC7562Rule } from './enum/ERC7562Rule'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { bannedOpCodes, opcodesOnlyInStakedEntities } from './ERC7562BannedOpcodes'
import { ValidationResult } from './IValidationManager'
import { AccessedSlots, ERC7562Call } from './ERC7562Call'
import { AltMempoolConfig } from './altmempool/AltMempoolConfig'
import { getOpcodeName } from './enum/EVMOpcodes'

export interface ERC7562ValidationResults {
  storageMap: StorageMap
  ruleViolations: ERC7562Violation[]
  contractAddresses: string[]
}

export class ERC7562Parser {
  private ruleViolations: ERC7562Violation[] = []
  private currentEntity: AccountAbstractionEntity = AccountAbstractionEntity.none
  private currentEntityAddress: string = ''
  private stakeValidationResult!: ValidationResult

  constructor (
    readonly mempoolConfig: AltMempoolConfig,
    readonly entryPointAddress: string,
    readonly senderCreatorAddress: string,
    readonly bailOnViolation: boolean
  ) {

  }

  private _isCallToEntryPoint (call: ERC7562Call): boolean {
    return call.to?.toLowerCase() === this.entryPointAddress?.toLowerCase() &&
      call.from?.toLowerCase() !== this.entryPointAddress?.toLowerCase() &&
      // skipping the top-level call from address(0) to 'simulateValidations()'
      call.from?.toLowerCase() !== AddressZero
  }

  private _isEntityStaked (): boolean {
    let entStake: StakeInfo | undefined
    switch (this.currentEntity) {
      case AccountAbstractionEntity.account:
        entStake = this.stakeValidationResult.senderInfo
        break
      case AccountAbstractionEntity.factory:
        entStake = this.stakeValidationResult.factoryInfo
        break
      case AccountAbstractionEntity.paymaster:
        entStake = this.stakeValidationResult.paymasterInfo
        break
      default:
        break
    }
    return entStake != null && BigNumber.from(1).lte(entStake.stake) && BigNumber.from(1).lte(entStake.unstakeDelaySec)
  }

  private _associatedWith (slot: string, addr: string, entitySlots: { [addr: string]: Set<string> }): boolean {
    const addrPadded = hexZeroPad(addr, 32).toLowerCase()
    if (slot === addrPadded) {
      return true
    }
    const k = entitySlots[addr]
    if (k == null) {
      return false
    }
    const slotN = BigNumber.from(slot)
    // scan all slot entries to check of the given slot is within a structure, starting at that offset.
    // assume a maximum size on a (static) structure size.
    for (const k1 of k.keys()) {
      const kn = BigNumber.from(k1)
      if (slotN.gte(kn) && slotN.lt(kn.add(128))) {
        return true
      }
    }
    return false
  }

  private _tryDetectKnownMethod (call: ERC7562Call): string {
    const mergedAbi = Object.values([
      ...SenderCreator__factory.abi,
      ...IEntryPoint__factory.abi,
      ...IPaymaster__factory.abi
    ])
    const AbiInterfaces = new Interface(mergedAbi)
    const methodSig = call.input.slice(0, 10)
    try {
      const abiFunction: FunctionFragment = AbiInterfaces.getFunction(methodSig)
      return abiFunction.name
    } catch (_) {}
    return methodSig
  }

  private _violationDetected (violation: ERC7562Violation): void {
    this.ruleViolations.push(violation)
    if (this.bailOnViolation) {
      throw toError(violation)
    }
  }

  private _detectEntityChange (userOp: OperationBase, call: ERC7562Call): void {
    if (call.from.toLowerCase() !== this.entryPointAddress.toLowerCase() &&
      call.from.toLowerCase() !== this.senderCreatorAddress.toLowerCase()) {
      return
    }
    if (userOp.sender.toLowerCase() === call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.account
      this.currentEntityAddress = userOp.sender
    } else if (
      call.from.toLowerCase() === this.senderCreatorAddress.toLowerCase() &&
      userOp.factory?.toLowerCase() === call.to.toLowerCase()
    ) {
      this.currentEntity = AccountAbstractionEntity.factory
      this.currentEntityAddress = userOp.factory
    } else if (userOp.paymaster?.toLowerCase() === call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.paymaster
      this.currentEntityAddress = userOp.paymaster
    } else if (this.entryPointAddress.toLowerCase() === call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.entryPoint
      this.currentEntityAddress = this.entryPointAddress
    } else if (this.senderCreatorAddress.toLowerCase() === call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.senderCreator
      this.currentEntityAddress = this.senderCreatorAddress
    } else {
      throw new RpcError(`could not find entity name for address ${call.to}. This should not happen. This is a bug.`, 0)
    }
  }

  private _tryGetAddressName (userOp: OperationBase, address: string): AccountAbstractionEntity | string {
    const lowerAddress = address.toLowerCase()
    if (lowerAddress === userOp.sender.toLowerCase()) {
      return AccountAbstractionEntity.account
    } else if (userOp.factory?.toLowerCase() === lowerAddress) {
      return AccountAbstractionEntity.factory
    } else if (userOp.paymaster?.toLowerCase() === lowerAddress) {
      return AccountAbstractionEntity.paymaster
    } else if (this.entryPointAddress.toLowerCase() === lowerAddress) {
      return AccountAbstractionEntity.entryPoint
    } else if (this.senderCreatorAddress.toLowerCase() === lowerAddress) {
      return AccountAbstractionEntity.senderCreator
    }
    return address
  }

  /**
   * Validates the UserOperation and throws an exception in case current mempool configuration rules were violated.
   */
  requireCompliance (
    userOp: OperationBase,
    tracerResults: ERC7562Call,
    validationResult: ValidationResult
  ): ERC7562ValidationResults {
    const results = this.parseResults(userOp, tracerResults, validationResult)
    if (results.ruleViolations.length > 0) {
      // TODO: human-readable description of which rules were violated.
      throw new Error('Rules Violated')
    }
    return results
  }

  parseResults (
    userOp: OperationBase,
    tracerResults: ERC7562Call,
    validationResult: ValidationResult
  ): ERC7562ValidationResults {
    if (tracerResults.calls == null || tracerResults.calls.length < 1) {
      throw new Error('Unexpected traceCall result: no calls from entrypoint.')
    }

    this.ruleViolations = []
    this.stakeValidationResult = validationResult

    return this._innerStepRecursive(userOp, tracerResults, 0)
  }

  private _innerStepRecursive (
    userOp: OperationBase,
    tracerResults: ERC7562Call,
    recursionDepth: number
  ): ERC7562ValidationResults {
    const address = tracerResults.to
    this._detectEntityChange(userOp, tracerResults)
    this.checkOp054(tracerResults)
    this.checkOp054ExtCode(tracerResults, address, recursionDepth)
    this.checkOp061(tracerResults)
    this.checkOp011(tracerResults)
    this.checkOp080(tracerResults)
    this.checkOp020(tracerResults)
    this.checkOp031(userOp, tracerResults)
    this.checkOp041(userOp, tracerResults)
    this.checkStorage(userOp, tracerResults)
    for (const call of tracerResults.calls ?? []) {
      this._innerStepRecursive(userOp, call, recursionDepth + 1)
    }
    return {
      contractAddresses: [], ruleViolations: this.ruleViolations, storageMap: {}
    }
  }

  /**
   * OP-052: May call `depositTo(sender)` with any value from either the `sender` or `factory`.
   * OP-053: May call the fallback function from the `sender` with any value.
   * OP-054: Any other access to the EntryPoint is forbidden.
   */
  checkOp054 (erc7562Call: ERC7562Call): void {
    const isCallToEntryPoint = this._isCallToEntryPoint(erc7562Call)
    const knownMethod = this._tryDetectKnownMethod(erc7562Call)
    const isEntryPointCallAllowedOP052 = knownMethod === 'depositTo'
    const isEntryPointCallAllowedOP053 = knownMethod === '0x'
    const isEntryPointCallAllowed = isEntryPointCallAllowedOP052 || isEntryPointCallAllowedOP053
    const isRuleViolated = isCallToEntryPoint && !isEntryPointCallAllowed
    if (isRuleViolated) {
      this._violationDetected({
        rule: ERC7562Rule.op054,
        // TODO: fill in depth, entity
        depth: -1,
        entity: this.currentEntity,
        address: erc7562Call.from,
        opcode: erc7562Call.type,
        value: erc7562Call.value,
        errorCode: ValidationErrors.OpcodeValidation,
        description: `illegal call into EntryPoint during validation ${knownMethod}`
      })
    }
  }

  /**
   * OP-061: CALL with value is forbidden. The only exception is a call to the EntryPoint.
   */
  checkOp061 (tracerResults: ERC7562Call): void {
    const isIllegalNonZeroValueCall =
      !this._isCallToEntryPoint(tracerResults) &&
      !BigNumber.from(tracerResults.value ?? 0).eq(0)
    if (isIllegalNonZeroValueCall) {
      this._violationDetected({
        rule: ERC7562Rule.op061,
        // TODO: fill in depth, entity
        depth: -1,
        entity: this.currentEntity,
        address: tracerResults.from,
        opcode: tracerResults.type,
        value: tracerResults.value,
        errorCode: ValidationErrors.OpcodeValidation,
        description: 'May not may CALL with value'
      })
    }
  }

  /**
   * OP-020: Revert on "out of gas" is forbidden as it can "leak" the gas limit or the current call stack depth.
   */
  checkOp020 (tracerResults: ERC7562Call): void {
    if (tracerResults.outOfGas) {
      this._violationDetected({
        rule: ERC7562Rule.op020,
        // TODO: fill in depth, entity
        depth: -1,
        entity: this.currentEntity,
        address: tracerResults.from,
        opcode: tracerResults.type,
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${this.currentEntity.toString()} internally reverts on oog`
      })
    }
  }

  /**
   * OP-011: Blocked opcodes
   * OP-080: `BALANCE` (0x31) and `SELFBALANCE` (0x47) are allowed only from a staked entity, else they are blocked
   */
  checkOp011 (tracerResults: ERC7562Call): void {
    const opcodes = tracerResults.usedOpcodes
    const bannedOpCodeUsed =
      Object
        .keys(opcodes)
        .map((opcode: string) => {
          return getOpcodeName(parseInt(opcode)) ?? ''
        })
        .filter((opcode: string) => {
          return bannedOpCodes.has(opcode)
        })
    bannedOpCodeUsed.forEach(
      (opcode: string): void => {
        this._violationDetected({
          rule: ERC7562Rule.op011,
          // TODO: fill in depth, entity
          depth: -1,
          entity: this.currentEntity,
          address: tracerResults.from,
          opcode,
          value: '0',
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${this.currentEntity.toString()} uses banned opcode: ${opcode.toString()}`
        })
      }
    )
  }

  checkOp080 (tracerResults: ERC7562Call): void {
    const opcodes = tracerResults.usedOpcodes
    const isEntityStaked = this._isEntityStaked()
    const onlyStakedOpCodeUsed =
      Object
        .keys(opcodes)
        .map((opcode: string) => {
          return getOpcodeName(parseInt(opcode)) ?? ''
        })
        .filter((opcode: string) => {
          return opcodesOnlyInStakedEntities.has(opcode) && !isEntityStaked
        })
    onlyStakedOpCodeUsed
      .forEach(
        (opcode: string): void => {
          this._violationDetected({
            rule: ERC7562Rule.op011,
            // TODO: fill in depth, entity
            depth: -1,
            entity: this.currentEntity,
            address: tracerResults.from ?? 'n/a',
            opcode,
            value: '0',
            errorCode: ValidationErrors.OpcodeValidation,
            description: `unstaked ${this.currentEntity.toString()} uses banned opcode: ${opcode}`
          })
        }
      )
  }

  /**
   * OP-031: CREATE2 is allowed exactly once in the deployment phase and must deploy code for the "sender" address
   */
  checkOp031 (
    userOp: OperationBase,
    tracerResults: ERC7562Call
  ): void {
    if (
      tracerResults.type !== 'CREATE' &&
      tracerResults.type !== 'CREATE2'
    ) {
      return
    }
    const isFactoryStaked = false
    const isAllowedCreateByOP032 =
      this.currentEntity === AccountAbstractionEntity.account &&
      tracerResults.from === userOp.sender.toLowerCase() &&
      isFactoryStaked
    const isAllowedCreateByEREP060 =
      this.currentEntity === AccountAbstractionEntity.factory &&
      tracerResults.from === userOp.factory &&
      isFactoryStaked
    const isAllowedCreateSenderByFactory =
      this.currentEntity === AccountAbstractionEntity.factory &&
      tracerResults.to === userOp.sender.toLowerCase()
    if (!(isAllowedCreateByOP032 || isAllowedCreateByEREP060 || isAllowedCreateSenderByFactory)) {
      this._violationDetected({
        rule: ERC7562Rule.op011,
        // TODO: fill in depth, entity
        depth: -1,
        entity: this.currentEntity,
        address: tracerResults.from ?? 'n/a',
        opcode: 'CREATE2',
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${this.currentEntity.toString()} uses banned opcode: CREATE2`
      })
    }
  }

  checkStorage (userOp: OperationBase, tracerResults: ERC7562Call): void {
    Object.entries(tracerResults.accessedSlots).forEach(([address, accessInfo]) => {
      this.checkStorageInternal(userOp, address, accessInfo)
    })
  }

  checkStorageInternal (
    userOp: OperationBase,
    address: string,
    accessInfo: AccessedSlots
  ): void {
    const allSlots: string[] = [
      ...Object.keys(accessInfo.writes ?? {}),
      ...Object.keys(accessInfo.reads ?? {}),
      ...Object.keys(accessInfo.transientWrites ?? {}),
      ...Object.keys(accessInfo.transientReads ?? {})
    ]
    const entitySlots = {} // TODO: restore
    const addressName = this._tryGetAddressName(userOp, address)
    const isEntityStaked = false // TODO
    const isFactoryStaked = false // TODO
    const isSenderCreation = false // TODO
    for (const slot of allSlots) {
      const isSenderInternalSTO010: boolean = address.toLowerCase() === userOp.sender.toLowerCase()
      const isSenderAssociated: boolean = this._associatedWith(slot, userOp.sender.toLowerCase(), entitySlots)
      const isEntityInternalSTO031: boolean = address.toLowerCase() === this.currentEntityAddress.toLowerCase()
      const isEntityAssociatedSTO032: boolean = this._associatedWith(slot, this.currentEntityAddress, entitySlots)
      const isReadOnlyAccessSTO033: boolean = accessInfo.writes?.[slot] == null && accessInfo.transientWrites?.[slot] == null

      const isAllowedIfEntityStaked = isEntityInternalSTO031 || isEntityAssociatedSTO032 || isReadOnlyAccessSTO033
      const isAllowedST031ST032ST033: boolean = isAllowedIfEntityStaked && isEntityStaked

      const isAllowedSTO021: boolean = isSenderAssociated && !isSenderCreation
      const isAllowedIfFactoryStaked = isSenderAssociated && isSenderCreation
      const isAllowedSTO022: boolean = isAllowedIfFactoryStaked && isFactoryStaked
      const allowed = isSenderInternalSTO010 || isAllowedSTO021 || isAllowedSTO022 || isAllowedST031ST032ST033
      if (!allowed) {
        let description: string
        if (
          (isAllowedIfEntityStaked && !isEntityStaked) ||
          (isAllowedIfFactoryStaked && !isFactoryStaked)
        ) {
          description = `unstaked ${this.currentEntity.toString()} accessed ${addressName} slot ${slot}`
        } else {
          const isWrite = Object.keys(accessInfo.writes ?? {}).includes(slot) || Object.keys(accessInfo.transientWrites ?? {}).includes(slot)
          const isTransient = Object.keys(accessInfo.transientReads ?? {}).includes(slot) || Object.keys(accessInfo.transientWrites ?? {}).includes(slot)
          const readWrite = isWrite ? 'write to' : 'read from'
          const transientStr = isTransient ? 'transient ' : ''
          description = `${this.currentEntity.toString()} has forbidden ${readWrite} ${transientStr}${addressName} slot ${slot}`
        }
        this._violationDetected({
          address: '',
          depth: 0,
          entity: this.currentEntity,
          errorCode: ValidationErrors.OpcodeValidation,
          rule: ERC7562Rule.sto010,
          description
        })
      }
    }
  }

  checkOp041 (
    userOp: OperationBase,
    tracerResults: ERC7562Call
  ): void {
    // the only contract we allow to access before its deployment is the "sender" itself, which gets created.
    let illegalZeroCodeAccess: any
    for (const addr of Object.keys(tracerResults.contractSize)) {
      // [OP-042]
      if (addr.toLowerCase() !== userOp.sender.toLowerCase() && addr.toLowerCase() !== this.entryPointAddress.toLowerCase() && tracerResults.contractSize[addr].contractSize <= 2) {
        illegalZeroCodeAccess = tracerResults.contractSize[addr]
        illegalZeroCodeAccess.address = addr
        this._violationDetected({
          address: '',
          depth: 0,
          entity: this.currentEntity,
          rule: ERC7562Rule.op041,
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${this.currentEntity.toString()} accesses un-deployed contract address ${illegalZeroCodeAccess?.address as string} with opcode ${illegalZeroCodeAccess?.opcode as string}`
        })
      }
    }
  }

  checkOp054ExtCode (
    tracerResults: ERC7562Call,
    address: string,
    recursionDepth: number
  ): void {
    const entityTitle = 'fixme'
    let illegalEntryPointCodeAccess
    for (const addr of Object.keys(tracerResults.extCodeAccessInfo)) {
      if (addr.toLowerCase() === this.entryPointAddress.toLowerCase()) {
        illegalEntryPointCodeAccess = tracerResults.extCodeAccessInfo
        this._violationDetected({
          address,
          depth: recursionDepth,
          entity: this.currentEntity,
          errorCode: ValidationErrors.OpcodeValidation,
          rule: ERC7562Rule.op054,
          description: `${entityTitle} accesses EntryPoint contract address ${this.entryPointAddress} with opcode $ {'todo'}`
        })
      }
    }
  }
}
