import { BigNumber } from 'ethers'
import { hexZeroPad } from 'ethers/lib/utils'

import { OperationBase, StorageMap, ValidationErrors } from '@account-abstraction/utils'

import { ERC7562Violation, toError } from './ERC7562Violation'
import { ERC7562Rule } from './enum/ERC7562Rule'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { bannedOpCodes, opcodesOnlyInStakedEntities } from './ERC7562BannedOpcodes'
import { ValidationResult } from './IValidationManager'
import { AccessedSlots, ERC7562Call } from './ERC7562Call'
import { AltMempoolConfig } from './altmempool/AltMempoolConfig'

export interface ERC7562ValidationResults {
  storageMap: StorageMap
  ruleViolations: ERC7562Violation[]
  contractAddresses: string[]
}

export class ERC7562Parser {
  private violations: ERC7562Violation[] = []

  constructor (
    readonly mempoolConfig: AltMempoolConfig,
    readonly entryPointAddress: string,
    readonly bailOnViolation: boolean
  ) {

  }

  private _isCallToEntryPoint (call: ERC7562Call): boolean {
    return call.to?.toLowerCase() === this.entryPointAddress?.toLowerCase() &&
      call.from?.toLowerCase() !== this.entryPointAddress?.toLowerCase()
  }

  private _isEntityStaked (topLevelCallInfo: ERC7562Call): boolean {
    throw new Error('Method not implemented.')
  }

  private _getEntity (userOp: OperationBase, address: string): AccountAbstractionEntity {
    return AccountAbstractionEntity.fixme
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

  private _violationDetected (violation: ERC7562Violation) {
    this.violations.push(violation)
    if (this.bailOnViolation) {
      throw toError(violation)
    }
  }

  /**
   * Validates the UserOperation and throws an exception in case current mempool configuration rules were violated.
   */
  requireCompliance (
    userOp: OperationBase,
    tracerResults: ERC7562Call,
    validationResult: ValidationResult
  ): ERC7562ValidationResults {
    const results = this.parseResults(userOp, tracerResults)
    if (results.ruleViolations.length > 0) {
      // TODO: human-readable description of which rules were violated.
      throw new Error('Rules Violated')
    }
    return results
  }

  parseResults (
    userOp: OperationBase,
    tracerResults: ERC7562Call
  ): ERC7562ValidationResults {
    this.violations = []

    if (tracerResults.calls == null || tracerResults.calls.length < 1) {
      throw new Error('Unexpected traceCall result: no calls from entrypoint.')
    }
    return this._innerStepRecursive(userOp, tracerResults, 0)
  }

  private _innerStepRecursive (
    userOp: OperationBase,
    tracerResults: ERC7562Call,
    recursionDepth: number
  ): ERC7562ValidationResults {

    this.checkOp054(tracerResults)
    this.checkOp054ExtCode(tracerResults)
    this.checkOp061(tracerResults)
    this.checkOp011(tracerResults)
    this.checkOp020(tracerResults)
    this.checkOp031(userOp, tracerResults)
    this.checkOp041(userOp, tracerResults)
    this.checkStorage(userOp, tracerResults)
    for (const call of tracerResults.calls ?? []) {
      this._innerStepRecursive(userOp, call, recursionDepth + 1)
    }
    return {
      contractAddresses: [], ruleViolations: [], storageMap: {}
    }
  }

  /**
   * OP-052: May call `depositTo(sender)` with any value from either the `sender` or `factory`.
   * OP-053: May call the fallback function from the `sender` with any value.
   * OP-054: Any other access to the EntryPoint is forbidden.
   */
  checkOp054 (erc7562Call: ERC7562Call): void {
    const isCallToEntryPoint = this._isCallToEntryPoint(erc7562Call)
    // @ts-ignore
    const isEntryPointCallAllowedOP052 = call.method === 'depositTo'
    // @ts-ignore
    const isEntryPointCallAllowedOP053 = call.method === '0x'
    const isEntryPointCallAllowed = isEntryPointCallAllowedOP052 || isEntryPointCallAllowedOP053
    const isRuleViolated = isCallToEntryPoint && !isEntryPointCallAllowed

    this._violationDetected({
      rule: ERC7562Rule.op054,
      // TODO: fill in depth, entity
      depth: -1,
      entity: AccountAbstractionEntity.fixme,
      address: erc7562Call.from,
      opcode: erc7562Call.type,
      value: erc7562Call.value,
      errorCode: ValidationErrors.OpcodeValidation,
      // @ts-ignore
      description: `illegal call into EntryPoint during validation ${it?.method}`
    })
  }

  /**
   * OP-061: CALL with value is forbidden. The only exception is a call to the EntryPoint.
   */
  checkOp061 (tracerResults: ERC7562Call): ERC7562Violation[] {
    const callStack = tracerResults.calls!.filter((call: any) => call.topLevelTargetAddress == null) as ERC7562Call[]
    const illegalNonZeroValueCall = callStack.filter(
      call =>
        !this._isCallToEntryPoint(call) &&
        !BigNumber.from(call.value ?? 0).eq(0)
    )
    return illegalNonZeroValueCall.map((it: ERC7562Call): ERC7562Violation => {
      return {
        rule: ERC7562Rule.op061,
        // TODO: fill in depth, entity
        depth: -1,
        entity: AccountAbstractionEntity.fixme,
        address: it.from,
        opcode: it.type,
        value: it.value,
        errorCode: ValidationErrors.OpcodeValidation,
        description: 'May not may CALL with value'
      }
    })
  }

  /**
   * OP-020: Revert on "out of gas" is forbidden as it can "leak" the gas limit or the current call stack depth.
   */
  checkOp020 (tracerResults: ERC7562Call): ERC7562Violation[] {
    const entityCallsFromEntryPoint = tracerResults.calls!.filter((call: any) => call.topLevelTargetAddress != null)
    const entityCallsWithOOG = entityCallsFromEntryPoint.filter((it: ERC7562Call) => it.outOfGas)
    return entityCallsWithOOG.map((it: ERC7562Call) => {
      const entityTitle = 'fixme'
      return {
        rule: ERC7562Rule.op020,
        // TODO: fill in depth, entity
        depth: -1,
        entity: AccountAbstractionEntity.fixme,
        address: it.from ?? 'n/a',
        opcode: it.type ?? 'n/a',
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${entityTitle} internally reverts on oog`
      }
    })
  }

  /**
   * OP-011: Blocked opcodes
   * OP-080: `BALANCE` (0x31) and `SELFBALANCE` (0x47) are allowed only from a staked entity, else they are blocked
   */
  checkOp011 (tracerResults: ERC7562Call): void {
    const opcodes = tracerResults.usedOpcodes
    const bannedOpCodeUsed = Object.keys(opcodes).filter((opcode: string) => {
      return bannedOpCodes.has(opcode)
    })
    bannedOpCodeUsed
      .forEach(
        (opcode: string): void => {
          const entityTitle = 'fixme'
          this._violationDetected({
            rule: ERC7562Rule.op011,
            // TODO: fill in depth, entity
            depth: -1,
            entity: AccountAbstractionEntity.fixme,
            address: tracerResults.from,
            opcode,
            value: '0',
            errorCode: ValidationErrors.OpcodeValidation,
            description: `${entityTitle} uses banned opcode: ${opcode}`
          })
        }
      )
  }

  checkOp080 (tracerResults: ERC7562Call): void {
    const opcodes = tracerResults.usedOpcodes
    const isEntityStaked = this._isEntityStaked(tracerResults)
    const onlyStakedOpCodeUsed = Object.keys(opcodes).filter((opcode: string) => {
      return opcodesOnlyInStakedEntities.has(opcode) && !isEntityStaked
    })
    onlyStakedOpCodeUsed
      .forEach(
        (opcode: string): void => {
          const entityTitle = 'fixme'
          this._violationDetected({
            rule: ERC7562Rule.op011,
            // TODO: fill in depth, entity
            depth: -1,
            entity: AccountAbstractionEntity.fixme,
            address: tracerResults.from ?? 'n/a',
            opcode,
            value: '0',
            errorCode: ValidationErrors.OpcodeValidation,
            description: `unstaked ${entityTitle} uses banned opcode: ${opcode}`
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
    const entityTitle = 'fixme' as string
    const isFactoryStaked = false
    const isAllowedCreateByOP032 = entityTitle === 'account' && isFactoryStaked && tracerResults.from === userOp.sender.toLowerCase()
    const isAllowedCreateByEREP060 = entityTitle === 'factory' && tracerResults.from === userOp.factory && isFactoryStaked
    const isAllowedCreateSenderByFactory = entityTitle === 'factory' && tracerResults.to === userOp.sender.toLowerCase()
    if (!(isAllowedCreateByOP032 || isAllowedCreateByEREP060 || isAllowedCreateSenderByFactory)) {
      this._violationDetected({
        rule: ERC7562Rule.op011,
        // TODO: fill in depth, entity
        depth: -1,
        entity: AccountAbstractionEntity.fixme,
        address: tracerResults.from ?? 'n/a',
        opcode: 'CREATE2',
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${entityTitle} uses banned opcode: CREATE2`
      })
    }
  }

  checkStorage (userOp: OperationBase, tracerResults: ERC7562Call): void {
    this.checkStorageInternal(userOp, tracerResults.calls![0])
  }

  checkStorageInternal (userOp: OperationBase, tracerResults: ERC7562Call): void {
    Object.entries(tracerResults.accessedSlots).forEach(([address, accessInfo]) => {
      this.checkStorageInternalInternal(userOp, address, accessInfo)
    })
  }

  checkStorageInternalInternal (
    userOp: OperationBase,
    address: string,
    accessInfo: AccessedSlots
  ): ERC7562Violation[] {
    const violations: ERC7562Violation[] = []
    const allSlots: string[] = [
      ...Object.keys(accessInfo.writes),
      ...Object.keys(accessInfo.reads),
      ...Object.keys(accessInfo.transientWrites ?? {}),
      ...Object.keys(accessInfo.transientReads ?? {})
    ]
    const entitySlots = {} // TODO: restore
    const entityAddress = '' // TODO: restore
    const isEntityStaked = false // TODO
    const isFactoryStaked = false // TODO
    const isSenderCreation = false // TODO
    for (const slot of allSlots) {
      const isSenderInternalSTO010: boolean = address.toLowerCase() === userOp.sender.toLowerCase()
      const isSenderAssociated: boolean = this._associatedWith(slot, userOp.sender.toLowerCase(), entitySlots)
      const isEntityInternalSTO031: boolean = address.toLowerCase() === entityAddress.toLowerCase()
      const isEntityAssociatedSTO032: boolean = this._associatedWith(slot, entityAddress, entitySlots)
      const isReadOnlyAccessSTO033: boolean = accessInfo.writes[slot] == null && accessInfo.transientWrites[slot] == null

      const isAllowedST031ST032ST033: boolean =
        (isEntityInternalSTO031 || isEntityAssociatedSTO032 || isReadOnlyAccessSTO033) && isEntityStaked

      const isAllowedSTO021: boolean = isSenderAssociated && !isSenderCreation
      const isAllowedSTO022: boolean = isSenderAssociated && isSenderCreation && isFactoryStaked
      const allowed = isSenderInternalSTO010 || isAllowedSTO021 || isAllowedSTO022 || isAllowedST031ST032ST033
      if (!allowed) {
        // TODO
        // @ts-ignore
        violations.push({
          // description: `${entityTitle} has forbidden ${readWrite} ${transientStr}${nameAddr(addr, stakeInfoEntities)} slot ${slot}`,
          // description: `unstaked ${entityTitle} accessed ${nameAddr(addr, stakeInfoEntities)} slot ${requireStakeSlot}`, entityTitle, access)
        })
      }
    }
    return violations
  }

  checkOp041 (
    userOp: OperationBase,
    tracerResults: ERC7562Call
  ): void {
    const entityTitle = 'fixme'
    // the only contract we allow to access before its deployment is the "sender" itself, which gets created.
    let illegalZeroCodeAccess: any
    for (const addr of Object.keys(tracerResults.contractSize)) {
      // [OP-042]
      if (addr.toLowerCase() !== userOp.sender.toLowerCase() && addr.toLowerCase() !== this.entryPointAddress.toLowerCase() && tracerResults.contractSize[addr].contractSize <= 2) {
        illegalZeroCodeAccess = tracerResults.contractSize[addr]
        illegalZeroCodeAccess.address = addr
        // @ts-ignore
        this._violationDetected({
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${entityTitle} accesses un-deployed contract address ${illegalZeroCodeAccess?.address as string} with opcode ${illegalZeroCodeAccess?.opcode as string}`
        })
      }
    }
  }

  checkOp054ExtCode (
    tracerResults: ERC7562Call
  ): void {
    const entityTitle = 'fixme'
    let illegalEntryPointCodeAccess
    for (const addr of Object.keys(tracerResults.extCodeAccessInfo)) {
      if (addr.toLowerCase() === this.entryPointAddress.toLowerCase()) {
        illegalEntryPointCodeAccess = tracerResults.extCodeAccessInfo
        // @ts-ignore
        violations.push({
          description: `${entityTitle} accesses EntryPoint contract address ${this.entryPointAddress} with opcode ${illegalEntryPointCodeAccess}`
        })
      }
    }
  }
}
