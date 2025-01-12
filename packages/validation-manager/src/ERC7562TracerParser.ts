import { ERC7562RuleViolation } from './ERC7562RuleViolation'
import { OperationBase, ValidationErrors } from '@account-abstraction/utils'
import { BundlerTracerResult, MethodInfo } from './BundlerCollectorTracer'
import { ERC7562Rule } from './ERC7562Rule'
import { AltMempoolConfig } from '@account-abstraction/utils/dist/src/altmempool/AltMempoolConfig'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { BigNumber } from 'ethers'

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
}
