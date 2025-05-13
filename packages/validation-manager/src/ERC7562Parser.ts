import { BigNumber } from 'ethers'
import { hexZeroPad, keccak256 } from 'ethers/lib/utils'

import {
  AddressZero,
  OperationBase,
  RpcError,
  SlotMap,
  StakeInfo,
  StorageMap,
  toBytes32,
  ValidationErrors
} from '@account-abstraction/utils'

import { ERC7562Violation, toError } from './ERC7562Violation'
import { ERC7562Rule } from './enum/ERC7562Rule'
import { AccountAbstractionEntity } from './AccountAbstractionEntity'
import { bannedOpCodes, opcodesOnlyInStakedEntities } from './ERC7562BannedOpcodes'
import { ValidationResult } from './IValidationManager'
import { ERC7562Call } from './ERC7562Call'
import { getOpcodeName } from './enum/EVMOpcodes'
import { _tryDetectKnownMethod, dumpCallTree } from './decodeHelper'

export interface ERC7562ValidationResults {
  storageMap: StorageMap
  ruleViolations: ERC7562Violation[]
  contractAddresses: string[]
}

export class ERC7562Parser {
  private keccak: string[] = []
  private ruleViolations: ERC7562Violation[] = []
  private currentEntity: AccountAbstractionEntity = AccountAbstractionEntity.none
  private currentEntityAddress: string = ''
  private stakeValidationResult!: ValidationResult

  private contractAddresses: string[] = []
  private storageMap: StorageMap = {}

  private bailOnViolation: boolean = false

  private readonly entryPointAddress: string
  private readonly senderCreatorAddress: string
  private readonly nonceManagerAddress?: string

  constructor (
    readonly _entryPointAddress: string,
    readonly _senderCreatorAddress: string,
    readonly _nonceManagerAddress?: string
  ) {
    this.entryPointAddress = _entryPointAddress.toLowerCase()
    this.senderCreatorAddress = _senderCreatorAddress.toLowerCase()
    this.nonceManagerAddress = _nonceManagerAddress?.toLowerCase()
  }

  /**
   * Analyzes the tracing results for the given UserOperation.
   * Throws an exception in case canonical ERC-7562 rule violation was detected.
   *
   * In order to get a list of violated rules use {@link parseResults} directly.
   * @returns {@link ERC7562ValidationResults} containing addresses and storage slots accessed by the UserOperation.
   */
  requireCompliance (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    validationResult: ValidationResult
  ): ERC7562ValidationResults {
    this.bailOnViolation = true
    const results = this.parseResults(userOp, erc7562Call, validationResult)
    this.bailOnViolation = false
    return results
  }

  /**
   * Analyzes the tracing results for the given UserOperation.
   *
   * Unlike {@link requireCompliance}, does not throw an exception in case a rule violation was detected.
   *
   * @returns {@link ERC7562ValidationResults} containing addresses and storage slots accessed by the UserOperation,
   * @returns an array of ERC-7562 rules that were violated by the UserOperation.
   */
  parseResults (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    validationResult: ValidationResult
  ): ERC7562ValidationResults {
    this._init(erc7562Call)
    if (erc7562Call.calls == null || erc7562Call.calls.length < 1) {
      throw new Error('Unexpected traceCall result: no calls from entrypoint.')
    }
    this.stakeValidationResult = validationResult
    dumpCallTree(erc7562Call, { ...userOp })
    this._innerStepRecursive(userOp, erc7562Call, 0, erc7562Call.to)
    return {
      contractAddresses: this.contractAddresses,
      ruleViolations: this.ruleViolations,
      storageMap: this.storageMap
    }
  }

  private _init (erc7562Call: ERC7562Call): void {
    this.keccak = erc7562Call.keccak ?? []
    this.ruleViolations = []
    this.currentEntity = AccountAbstractionEntity.none
    this.currentEntityAddress = ''
    this.contractAddresses = []
    this.storageMap = {}
  }

  private _isCallToEntryPoint (erc7562Call: ERC7562Call): boolean {
    return erc7562Call.to?.toLowerCase() === this.entryPointAddress?.toLowerCase() &&
      erc7562Call.from?.toLowerCase() !== this.entryPointAddress?.toLowerCase() &&
      // skipping the top-level call from address(0) to 'simulateValidations()'
      erc7562Call.from?.toLowerCase() !== AddressZero
  }

  private _isEntityStaked (entity?: AccountAbstractionEntity): boolean {
    let entStake: StakeInfo | undefined
    switch (entity ?? this.currentEntity) {
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

  private _violationDetected (violation: ERC7562Violation): void {
    this.ruleViolations.push(violation)
    console.error('violationDetected:', JSON.stringify(violation))
    if (this.bailOnViolation) {
      throw toError(violation)
    }
  }

  private _detectEntityChange (userOp: OperationBase, erc7562Call: ERC7562Call): void {
    if (
      erc7562Call.from.toLowerCase() !== AddressZero &&
      erc7562Call.from.toLowerCase() !== this.entryPointAddress &&
      erc7562Call.from.toLowerCase() !== this.senderCreatorAddress) {
      return
    }
    const nonceManagerAddress = this.nonceManagerAddress
    if (userOp.sender.toLowerCase() === erc7562Call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.account
      this.currentEntityAddress = userOp.sender
    } else if (
      erc7562Call.from.toLowerCase() === this.senderCreatorAddress &&
      userOp.factory?.toLowerCase() === erc7562Call.to.toLowerCase()
    ) {
      this.currentEntity = AccountAbstractionEntity.factory
      this.currentEntityAddress = userOp.factory
    } else if (userOp.paymaster?.toLowerCase() === erc7562Call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.paymaster
      this.currentEntityAddress = userOp.paymaster
    } else if (this.entryPointAddress === erc7562Call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.entryPoint
      this.currentEntityAddress = this.entryPointAddress
    } else if (this.senderCreatorAddress === erc7562Call.to.toLowerCase()) {
      this.currentEntity = AccountAbstractionEntity.senderCreator
      this.currentEntityAddress = this.senderCreatorAddress
    } else if (
      nonceManagerAddress != null &&
      nonceManagerAddress.toLowerCase() === erc7562Call.to.toLowerCase()
    ) {
      this.currentEntity = AccountAbstractionEntity.nativeNonceManager
      this.currentEntityAddress = nonceManagerAddress
    } else {
      throw new RpcError(`could not find entity name for address ${erc7562Call.to}. This should not happen. This is a bug.`, 0)
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
    } else if (this.entryPointAddress === lowerAddress) {
      return AccountAbstractionEntity.entryPoint
    } else if (this.senderCreatorAddress === lowerAddress) {
      return AccountAbstractionEntity.senderCreator
    }
    return address
  }

  /**
   * Calculate storage slots associated with each entity.
   * keccak( A || ...) is associated with "A"
   *
   * @param userOp
   */
  private _parseEntitySlots (
    userOp: OperationBase
  ): {
      [addr: string]: Set<string>
    } {
    // for each entity (sender, factory, paymaster), hold the valid slot addresses
    const entityAddresses = [userOp.sender.toLowerCase(), userOp.paymaster?.toLowerCase(), userOp.factory?.toLowerCase()]
    const entitySlots: { [addr: string]: Set<string> } = {}

    for (const keccakInput of this.keccak) {
      for (const entityAddress of entityAddresses) {
        if (entityAddress == null) {
          continue
        }
        const addrPadded = toBytes32(entityAddress)
        // valid slot: the slot was generated by keccak(entityAddr || ...)
        if (keccakInput.startsWith(addrPadded)) {
          if (entitySlots[entityAddress] == null) {
            entitySlots[entityAddress] = new Set<string>()
          }
          entitySlots[entityAddress].add(keccak256(keccakInput))
        }
      }
    }
    return entitySlots
  }

  private _innerStepRecursive (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    const address: string = erc7562Call.to
    if (address === this.entryPointAddress && erc7562Call.from === this.entryPointAddress) {
      // don't enforce rules self-call (it's an "innerHandleOp" that slipped into the trace)
      return
    }
    this.contractAddresses.push(address)
    this._detectEntityChange(userOp, erc7562Call)
    this._checkOp011(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp020(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp031(userOp, erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp041(userOp, erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp054(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp054ExtCode(erc7562Call, address, recursionDepth, delegatecallStorageAddress)
    this._checkOp061(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp062AllowedPrecompiles(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkOp080(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkErep050(erc7562Call, recursionDepth, delegatecallStorageAddress)
    this._checkStorage(userOp, erc7562Call, recursionDepth, delegatecallStorageAddress)
    for (const call of erc7562Call.calls ?? []) {
      let newContext: string = call.to
      if (call.type === 'DELEGATECALL') {
        newContext = delegatecallStorageAddress
      }
      this._innerStepRecursive(userOp, call, recursionDepth + 1, newContext)
    }
  }

  /**
   * OP-011: Blocked opcodes
   * OP-080: `BALANCE` (0x31) and `SELFBALANCE` (0x47) are allowed only from a staked entity, else they are blocked
   */
  private _checkOp011 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    if (erc7562Call.to.toLowerCase() === this.entryPointAddress) {
      // Currently inside the EntryPoint deposit code, no access control applies here
      return
    }
    const opcodes = erc7562Call.usedOpcodes
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
          depth: recursionDepth,
          entity: this.currentEntity,
          address: erc7562Call.to,
          delegatecallStorageAddress,
          callFrameType: erc7562Call.type,
          opcode,
          value: '0',
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${this.currentEntity.toString()} uses banned opcode: ${opcode.toString()}`
        })
      }
    )
  }

  /**
   * OP-020: Revert on "out of gas" is forbidden as it can "leak" the gas limit or the current call stack depth.
   */
  private _checkOp020 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    if (erc7562Call.outOfGas) {
      this._violationDetected({
        rule: ERC7562Rule.op020,
        // TODO: fill in depth, entity
        depth: recursionDepth,
        entity: this.currentEntity,
        address: erc7562Call.from,
        delegatecallStorageAddress,
        opcode: erc7562Call.type,
        callFrameType: erc7562Call.type,
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${this.currentEntity.toString()} internally reverts on oog`
      })
    }
  }

  /**
   * OP-031: CREATE2 is allowed exactly once in the deployment phase and must deploy code for the "sender" address
   */
  private _checkOp031 (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    if (
      erc7562Call.type !== 'CREATE' &&
      erc7562Call.type !== 'CREATE2'
    ) {
      return
    }
    const isFactoryStaked = this._isEntityStaked(AccountAbstractionEntity.factory)
    const isAllowedCreateByOP032 =
      userOp.factory != null &&
      erc7562Call.type === 'CREATE' &&
      (
        this.currentEntity === AccountAbstractionEntity.account ||
        this.currentEntity === AccountAbstractionEntity.factory
      ) &&
      erc7562Call.from.toLowerCase() === userOp.sender.toLowerCase()
    const isAllowedCreateByEREP060 =
      (
        erc7562Call.from.toLowerCase() === userOp.sender?.toLowerCase() ||
        erc7562Call.from.toLowerCase() === userOp.factory?.toLowerCase()
      ) &&
      isFactoryStaked
    const isAllowedCreateSenderByFactory =
      this.currentEntity === AccountAbstractionEntity.factory &&
      erc7562Call.to.toLowerCase() === userOp.sender.toLowerCase()
    if (!(isAllowedCreateByOP032 || isAllowedCreateByEREP060 || isAllowedCreateSenderByFactory)) {
      this._violationDetected({
        rule: ERC7562Rule.op011,
        depth: recursionDepth,
        entity: this.currentEntity,
        address: erc7562Call.from ?? 'n/a',
        delegatecallStorageAddress,
        callFrameType: erc7562Call.type,
        opcode: 'CREATE2',
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: `${this.currentEntity.toString()} uses banned opcode: CREATE2`
      })
    }
  }

  /**
   * OP-041: Access to an address without a deployed code is forbidden for EXTCODE* and *CALL opcodes
   */
  private _checkOp041 (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    // the only contract we allow to access before its deployment is the "sender" itself, which gets created.
    let illegalZeroCodeAccess: any
    for (const address of Object.keys(erc7562Call.contractSize)) {
      // skip precompiles
      if (this._isPrecompiled(address)) {
        continue
      }
      // [OP-042]
      if (
        address.toLowerCase() !== userOp.sender.toLowerCase() &&
        // address.toLowerCase() !== AA_ENTRY_POINT &&
        address.toLowerCase() !== this.entryPointAddress &&
        erc7562Call.contractSize[address].contractSize <= 2) {
        illegalZeroCodeAccess = erc7562Call.contractSize[address]
        illegalZeroCodeAccess.address = address
        this._violationDetected({
          address,
          delegatecallStorageAddress,
          depth: recursionDepth,
          entity: this.currentEntity,
          callFrameType: erc7562Call.type,
          rule: ERC7562Rule.op041,
          errorCode: ValidationErrors.OpcodeValidation,
          description: `${this.currentEntity.toString()} accesses un-deployed contract address ${illegalZeroCodeAccess?.address as string} with opcode ${illegalZeroCodeAccess?.opcode as string}`
        })
      }
    }
  }

  /**
   * OP-052: May call `depositTo(sender)` with any value from either the `sender` or `factory`.
   * OP-053: May call the fallback function from the `sender` with any value.
   * OP-054: Any other access to the EntryPoint is forbidden.
   */
  private _checkOp054 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    const isCallToEntryPoint = this._isCallToEntryPoint(erc7562Call)
    const knownMethod = _tryDetectKnownMethod(erc7562Call)
    const isEntryPointCallAllowedRIP7560 = knownMethod === 'acceptAccount' ||
      knownMethod === 'acceptPaymaster' ||
      knownMethod === 'sigFailAccount' ||
      knownMethod === 'sigFailPaymaster'
    const isEntryPointCallAllowedOP052 = knownMethod === 'depositTo'
    const isEntryPointCallAllowedOP053 = knownMethod === '0x'
    const isEntryPointCallAllowed = isEntryPointCallAllowedOP052 ||
      isEntryPointCallAllowedOP053 ||
      isEntryPointCallAllowedRIP7560
    const isRuleViolated = isCallToEntryPoint && !isEntryPointCallAllowed
    if (isRuleViolated) {
      this._violationDetected({
        rule: ERC7562Rule.op054,
        depth: recursionDepth,
        entity: this.currentEntity,
        address: erc7562Call.from,
        delegatecallStorageAddress,
        opcode: erc7562Call.type,
        value: erc7562Call.value,
        callFrameType: erc7562Call.type,
        errorCode: ValidationErrors.OpcodeValidation,
        description: `illegal call into EntryPoint during validation ${knownMethod}`
      })
    }
  }

  private _checkOp054ExtCode (
    erc7562Call: ERC7562Call,
    address: string,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    for (const addr of erc7562Call.extCodeAccessInfo) {
      if (addr.toLowerCase() === this.entryPointAddress) {
        this._violationDetected({
          address,
          delegatecallStorageAddress,
          depth: recursionDepth,
          entity: this.currentEntity,
          errorCode: ValidationErrors.OpcodeValidation,
          callFrameType: erc7562Call.type,
          rule: ERC7562Rule.op054,
          description: `${this.currentEntity} accesses EntryPoint contract address ${this.entryPointAddress} with EXTCODE* opcode`
        })
      }
    }
  }

  /**
   * OP-061: CALL with value is forbidden. The only exception is a call to the EntryPoint.
   */
  private _checkOp061 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    const isIllegalNonZeroValueCall =
      !this._isCallToEntryPoint(erc7562Call) &&
      !BigNumber.from(erc7562Call.value ?? 0).eq(0)
    if (isIllegalNonZeroValueCall) {
      this._violationDetected({
        rule: ERC7562Rule.op061,
        depth: recursionDepth,
        entity: this.currentEntity,
        address: erc7562Call.from,
        delegatecallStorageAddress,
        opcode: erc7562Call.type,
        value: erc7562Call.value,
        callFrameType: erc7562Call.type,
        errorCode: ValidationErrors.OpcodeValidation,
        description: 'May not make a CALL with value'
      })
    }
  }

  /**
   * OP-062: Precompiles:
   *
   *     Only allow known accepted precompiles on the network, that do not access anything in the blockchain state or environment.
   *     The core precompiles 0x1 .. 0x9
   *     The RIP-7212 sec256r1 precompile, on networks that accepted it.
   */
  private _checkOp062AllowedPrecompiles (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    for (const address of Object.keys(erc7562Call.contractSize)) {
      if (this._isForbiddenPrecompiled(address)) {
        this._violationDetected({
          rule: ERC7562Rule.op062,
          depth: recursionDepth,
          entity: this.currentEntity,
          address: erc7562Call.from,
          opcode: erc7562Call.type,
          value: erc7562Call.value,
          errorCode: ValidationErrors.OpcodeValidation,
          description: 'Illegal call to forbidden precompile ' + address,
          callFrameType: erc7562Call.type,
          delegatecallStorageAddress
        })
      }
    }
  }

  /**
   * OP-080: BALANCE (0x31) and SELFBALANCE (0x47) are allowed only from a staked entity, else they are blocked
   */
  private _checkOp080 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    const opcodes = erc7562Call.usedOpcodes
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
            depth: recursionDepth,
            entity: this.currentEntity,
            address: erc7562Call.from ?? 'n/a',
            delegatecallStorageAddress,
            opcode,
            callFrameType: erc7562Call.type,
            value: '0',
            errorCode: ValidationErrors.OpcodeValidation,
            description: `unstaked ${this.currentEntity.toString()} uses banned opcode: ${opcode}`
          })
        }
      )
  }

  /**
   * EREP-050: An unstaked `paymaster` may not return a `context`.
   */
  private _checkErep050 (
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    const isUnstakedPaymaster = this.currentEntity === AccountAbstractionEntity.paymaster && !this._isEntityStaked()
    if (isUnstakedPaymaster && this.stakeValidationResult.paymasterInfo?.context != null && this.stakeValidationResult.paymasterInfo?.context !== '0x') {
      this._violationDetected({
        rule: ERC7562Rule.erep050,
        depth: recursionDepth,
        entity: this.currentEntity,
        address: erc7562Call.from ?? 'n/a',
        delegatecallStorageAddress,
        callFrameType: erc7562Call.type,
        value: '0',
        errorCode: ValidationErrors.OpcodeValidation,
        description: 'unstaked paymaster returned a context'
      })
    }
  }

  private _checkStorage (
    userOp: OperationBase,
    erc7562Call: ERC7562Call,
    recursionDepth: number,
    delegatecallStorageAddress: string
  ): void {
    if (
      erc7562Call.to.toLowerCase() === this.entryPointAddress ||
      erc7562Call.to.toLowerCase() === this.nonceManagerAddress
    ) {
      // Currently inside system code, no access control applies here
      return
    }
    const allSlots: string[] = [
      ...Object.keys(erc7562Call.accessedSlots.writes ?? {}),
      ...Object.keys(erc7562Call.accessedSlots.reads ?? {}),
      ...Object.keys(erc7562Call.accessedSlots.transientWrites ?? {}),
      ...Object.keys(erc7562Call.accessedSlots.transientReads ?? {})
    ]
    const address: string = erc7562Call.to
    const entitySlots = this._parseEntitySlots(userOp)
    const addressName = this._tryGetAddressName(userOp, address)
    const isEntityStaked = this._isEntityStaked()
    const isFactoryStaked = this._isEntityStaked(AccountAbstractionEntity.factory)
    const isSenderCreation = userOp.factory != null
    for (const slot of allSlots) {
      if (this.storageMap[address] == null) {
        this.storageMap[address] = {}
      }
      (this.storageMap[address] as SlotMap)[slot] = '' // TODO: not clear why were the values relevant
      const isSenderInternalSTO010: boolean = address.toLowerCase() === userOp.sender.toLowerCase()
      const isSenderAssociated: boolean = this._associatedWith(slot, userOp.sender.toLowerCase(), entitySlots)
      const isEntityInternalSTO031: boolean = address.toLowerCase() === this.currentEntityAddress.toLowerCase()
      const isEntityAssociatedSTO032: boolean = this._associatedWith(slot, this.currentEntityAddress.toLowerCase(), entitySlots)
      const isReadOnlyAccessSTO033: boolean = erc7562Call.accessedSlots.writes?.[slot] == null && erc7562Call.accessedSlots.transientWrites?.[slot] == null

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
          const isWrite = Object.keys(erc7562Call.accessedSlots.writes ?? {}).includes(slot) || Object.keys(erc7562Call.accessedSlots.transientWrites ?? {}).includes(slot)
          const isTransient = Object.keys(erc7562Call.accessedSlots.transientReads ?? {}).includes(slot) || Object.keys(erc7562Call.accessedSlots.transientWrites ?? {}).includes(slot)
          const readWrite = isWrite ? 'write to' : 'read from'
          const transientStr = isTransient ? 'transient ' : ''
          description = `${this.currentEntity.toString()} has forbidden ${readWrite} ${transientStr}${addressName} slot ${slot}`
        }
        this._violationDetected({
          address,
          delegatecallStorageAddress,
          depth: recursionDepth,
          entity: this.currentEntity,
          errorCode: ValidationErrors.OpcodeValidation,
          rule: ERC7562Rule.sto010,
          callFrameType: erc7562Call.type,
          description
        })
      }
    }
  }

  private _isPrecompiled (address: string): boolean {
    const intAddress = parseInt(address, 16)
    if (intAddress < 1000 && intAddress >= 1) {
      return true
    }
    return false
  }

  private _isForbiddenPrecompiled (address: string): boolean {
    const intAddress = parseInt(address, 16)
    return this._isPrecompiled(address) && intAddress > 9
  }
}
