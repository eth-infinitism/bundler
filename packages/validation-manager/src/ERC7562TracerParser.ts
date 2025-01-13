import { ERC7562RuleViolation } from './ERC7562RuleViolation'
import { OperationBase, requireCond, ValidationErrors } from '@account-abstraction/utils'
import {
  AccessInfo,
  BundlerTracerResult,
  MethodInfo,
  StorageAccessInfos,
  TopLevelCallInfo
} from './BundlerCollectorTracer'
import { ERC7562Rule } from './ERC7562Rule'
import { AltMempoolConfig } from '@account-abstraction/utils/dist/src/altmempool/AltMempoolConfig'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { BigNumber } from 'ethers'
import { associatedWith, bannedOpCodes, opcodesOnlyInStakedEntities } from './TracerResultParser'

export class ERC7562TracerParser {
  constructor (
    readonly mempoolConfig: AltMempoolConfig,
    readonly entryPointAddress: string
  ) {

  }

  private _isCallToEntryPoint (call: MethodInfo): boolean {
    return call.to?.toLowerCase() === this.entryPointAddress?.toLowerCase() &&
      call.from?.toLowerCase() !== this.entryPointAddress?.toLowerCase()
  }

  private _isEntityStaked (topLevelCallInfo: TopLevelCallInfo): boolean {
    throw new Error('Method not implemented.')
  }

  private _getEntity (userOp: OperationBase, address: string): AccountAbstractionEntity {
    return AccountAbstractionEntity.fixme
  }

  /**
   * Validates the UserOperation and throws an exception in case current mempool configuration rules were violated.
   */
  requireCompliance (
    userOp: OperationBase,
    tracerResults: BundlerTracerResult
  ): void {
    const violations = this.parseResults(userOp, tracerResults)
    if (violations.length > 0) {
      // TODO: human-readable description of which rules were violated.
      throw new Error('Rules Violated')
    }
  }

  parseResults (
    userOp: OperationBase,
    tracerResults: BundlerTracerResult
  ): ERC7562RuleViolation[] {
    this.checkSanity(tracerResults)
    this.checkOp054(tracerResults)
    this.checkOp061(tracerResults)
    this.checkOp011(tracerResults)
    this.checkOp020(tracerResults)
    this.checkOp031(userOp, tracerResults)
    this.checkStorage(userOp, tracerResults)
    return []
  }

  checkSanity (tracerResults: BundlerTracerResult): void {
    if (Object.values(tracerResults.callsFromEntryPoint).length < 1) {
      throw new Error('Unexpected traceCall result: no calls from entrypoint.')
    }
  }

  /**
   * OP-052: May call `depositTo(sender)` with any value from either the `sender` or `factory`.
   * OP-053: May call the fallback function from the `sender` with any value.
   * OP-054: Any other access to the EntryPoint is forbidden.
   */
  checkOp054 (tracerResults: BundlerTracerResult): ERC7562RuleViolation[] {
    const callStack = tracerResults.calls.filter((call: any) => call.topLevelTargetAddress == null) as MethodInfo[]
    const callInfoEntryPoint = callStack.filter(call => {
      const isCallToEntryPoint = this._isCallToEntryPoint(call)
      const isEntryPointCallAllowedOP052 = call.method === 'depositTo'
      const isEntryPointCallAllowedOP053 = call.method === '0x'
      const isEntryPointCallAllowed = isEntryPointCallAllowedOP052 || isEntryPointCallAllowedOP053
      return isCallToEntryPoint && !isEntryPointCallAllowed
    })
    return callInfoEntryPoint.map((it: MethodInfo): ERC7562RuleViolation => {
      return {
        rule: ERC7562Rule.op054,
        // TODO: fill in depth, entity
        depth: -1,
        entity: AccountAbstractionEntity.fixme,
        address: it.from,
        opcode: it.type,
        value: it.value,
        errorCode: ValidationErrors.OpcodeValidation,
        description: `illegal call into EntryPoint during validation ${it?.method}`
      }
    })
  }

  /**
   * OP-061: CALL with value is forbidden. The only exception is a call to the EntryPoint.
   */
  checkOp061 (tracerResults: BundlerTracerResult): ERC7562RuleViolation[] {
    const callStack = tracerResults.calls.filter((call: any) => call.topLevelTargetAddress == null) as MethodInfo[]
    const illegalNonZeroValueCall = callStack.filter(
      call =>
        !this._isCallToEntryPoint(call) &&
        !BigNumber.from(call.value ?? 0).eq(0)
    )
    return illegalNonZeroValueCall.map((it: MethodInfo): ERC7562RuleViolation => {
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
  checkOp020 (tracerResults: BundlerTracerResult): ERC7562RuleViolation[] {
    const entityCallsFromEntryPoint = tracerResults.callsFromEntryPoint.filter((call: any) => call.topLevelTargetAddress != null)
    const entityCallsWithOOG = entityCallsFromEntryPoint.filter((it: TopLevelCallInfo) => it.oog)
    return entityCallsWithOOG.map((it: TopLevelCallInfo) => {
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
  checkOp011 (tracerResults: BundlerTracerResult): ERC7562RuleViolation[] {
    const entityCallsFromEntryPoint = tracerResults.callsFromEntryPoint.filter((call: any) => call.topLevelTargetAddress != null)
    const violations: ERC7562RuleViolation[] = []
    for (const topLevelCallInfo of entityCallsFromEntryPoint) {
      const opcodes = topLevelCallInfo.opcodes
      const bannedOpCodeUsed = Object.keys(opcodes).filter((opcode: string) => {
        return bannedOpCodes.has(opcode)
      })
      // TODO: TBD: Creating an object for each violation may be wasteful but makes it easier to choose a right mempool.
      const bannedOpcodesViolations: ERC7562RuleViolation[] =
        bannedOpCodeUsed
          .map(
            (opcode: string): ERC7562RuleViolation => {
              const entityTitle = 'fixme'
              return {
                rule: ERC7562Rule.op011,
                // TODO: fill in depth, entity
                depth: -1,
                entity: AccountAbstractionEntity.fixme,
                address: topLevelCallInfo.from ?? 'n/a',
                opcode,
                value: '0',
                errorCode: ValidationErrors.OpcodeValidation,
                description: `${entityTitle} uses banned opcode: ${opcode}`
              }
            }
          )
      violations.push(...bannedOpcodesViolations)

      // TODO: Deduplicate code in an elegant way
      // TODO: Extract OP-080 into a separate function
      const onlyStakedOpCodeUsed = Object.keys(opcodes).filter((opcode: string) => {
        return opcodesOnlyInStakedEntities.has(opcode) && !this._isEntityStaked(topLevelCallInfo)
      })
      const onlyStakedOpcodesViolations: ERC7562RuleViolation[] =
        onlyStakedOpCodeUsed
          .map(
            (opcode: string): ERC7562RuleViolation => {
              const entityTitle = 'fixme'
              return {
                rule: ERC7562Rule.op011,
                // TODO: fill in depth, entity
                depth: -1,
                entity: AccountAbstractionEntity.fixme,
                address: topLevelCallInfo.from ?? 'n/a',
                opcode,
                value: '0',
                errorCode: ValidationErrors.OpcodeValidation,
                description: `unstaked ${entityTitle} uses banned opcode: ${opcode}`
              }
            }
          )
      violations.push(...onlyStakedOpcodesViolations)
    }
    return violations
  }

  /**
   * OP-031: CREATE2 is allowed exactly once in the deployment phase and must deploy code for the "sender" address
   */
  checkOp031 (
    userOp: OperationBase,
    tracerResults: BundlerTracerResult
  ): ERC7562RuleViolation[] {
    const entityCallsFromEntryPoint = tracerResults.callsFromEntryPoint.filter((call: any) => call.topLevelTargetAddress != null)
    const violations: ERC7562RuleViolation[] = []
    for (const topLevelCallInfo of entityCallsFromEntryPoint) {
      if (
        topLevelCallInfo.type !== 'CREATE' &&
        topLevelCallInfo.type !== 'CREATE2'
      ) {
        continue
      }
      const entityTitle = 'fixme' as string
      const isFactoryStaked = false
      const isAllowedCreateByOP032 = entityTitle === 'account' && isFactoryStaked && topLevelCallInfo.from === userOp.sender.toLowerCase()
      const isAllowedCreateByEREP060 = entityTitle === 'factory' && topLevelCallInfo.from === userOp.factory && isFactoryStaked
      const isAllowedCreateSenderByFactory = entityTitle === 'factory' && topLevelCallInfo.to === userOp.sender.toLowerCase()
      if (!(isAllowedCreateByOP032 || isAllowedCreateByEREP060 || isAllowedCreateSenderByFactory)) {
        violations.push({
          rule: ERC7562Rule.op011,
          // TODO: fill in depth, entity
          depth: -1,
          entity: AccountAbstractionEntity.fixme,
          address: topLevelCallInfo.from ?? 'n/a',
          opcode: 'CREATE2',
          value: '0',
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${entityTitle} uses banned opcode: CREATE2`
        })
      }
    }
    return violations
  }

  checkStorage (userOp: OperationBase, tracerResults: BundlerTracerResult): ERC7562RuleViolation[] {
    this.checkStorageInternal(userOp, tracerResults.callsFromEntryPoint[0].access)
    return []
  }

  checkStorageInternal (userOp: OperationBase, access: StorageAccessInfos): ERC7562RuleViolation[] {
    Object.entries(access).forEach(([address, accessInfo]) => {
      this.checkStorageInternalInternal(userOp, address, accessInfo)
    })
    return []
  }

  checkStorageInternalInternal (
    userOp: OperationBase,
    address: string,
    accessInfo: AccessInfo
  ): ERC7562RuleViolation[] {
    const violations: ERC7562RuleViolation[] = []
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
      const isSenderAssociated: boolean = associatedWith(slot, userOp.sender.toLowerCase(), entitySlots)
      const isEntityInternalSTO031: boolean = address.toLowerCase() === entityAddress.toLowerCase()
      const isEntityAssociatedSTO032: boolean = associatedWith(slot, entityAddress, entitySlots)
      const isReadOnlyAccessSTO033: boolean = accessInfo.writes[slot] == null && accessInfo.transientWrites[slot] == null

      const allowedST031ST032ST033: boolean =
        (isEntityInternalSTO031 || isEntityAssociatedSTO032 || isReadOnlyAccessSTO033) && isEntityStaked

      const allowedSTO021: boolean = isSenderAssociated && !isSenderCreation
      const allowedSTO022: boolean = isSenderAssociated && isSenderCreation && isFactoryStaked
      const allowed = allowedSTO021 || allowedSTO022 || allowedST031ST032ST033
      if (!allowed) {
        // TODO
        // @ts-ignore
        violations.push({})
      }
    }
    return violations
  }
}
