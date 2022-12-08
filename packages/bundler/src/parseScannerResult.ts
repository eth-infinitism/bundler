import { EntryPoint } from '@account-abstraction/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { hexZeroPad, keccak256 } from 'ethers/lib/utils'
import { BundlerCollectorReturn, MethodInfo } from './BundlerCollectorTracer'
import { requireCond } from './utils'
import { inspect } from 'util'

import Debug from 'debug'
import { UserOperation } from './modules/moduleUtils'
import { ValidationErrors, ValidationResult } from './modules/ValidationManager'
import { BigNumber } from 'ethers'

const debug = Debug('aa.handler.opcodes')

export async function isGeth (provider: JsonRpcProvider): Promise<boolean> {
  const p = provider.send as any
  if (p._clientVersion == null) {
    p._clientVersion = await provider.send('web3_clientVersion', [])
  }

  debug('client version', p._clientVersion)
  return p._clientVersion?.match('Geth') != null
}

/**
 * parse collected simulation traces and revert if they break our rules
 * @param userOp the userOperation that was used in this simulation
 * @param tracerResults the tracer return value
 * @aaram validationResult output from simulateValidation
 * @param entryPoint the entryPoint that hosted the "simulatedValidation" traced call.
 */
export function parseScannerResult (userOp: UserOperation, tracerResults: BundlerCollectorReturn, validationResult: ValidationResult, entryPoint: EntryPoint): void {
  debug('=== simulation result:', inspect(tracerResults, true, 10, true))
  // todo: block access to no-code addresses (might need update to tracer)

  const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'GAS', 'CREATE', 'COINBASE', 'SELFDESTRUCT'])

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (Object.values(tracerResults.numberLevels).length < 2) {
    // console.log('calls=', result.calls.map(x=>JSON.stringify(x)).join('\n'))
    // console.log('debug=', result.debug)
    throw new Error('Unexpected traceCall result: no NUMBER opcodes, and not REVERT')
  }
  const handleOpsMethodSig = entryPoint.interface.getSighash('innerHandleOp')
  tracerResults.calls.forEach(call => {
    if (call.type.includes('CALL')) {
      const call1 = call as MethodInfo
      requireCond(entryPoint.address !== call1.to || call1.method !== handleOpsMethodSig.toString(),
        'Must not make recursive call to handleOps', ValidationErrors.OpcodeValidation)
    }
  })

  const sender = userOp.sender.toLowerCase()
  // stake info per "number" level (factory, sender, paymaster)
  // we only use stake info if we notice a memory reference that require stake
  const stakeInfoArray = [validationResult.factoryInfo, validationResult.senderInfo, validationResult.paymasterInfo]

  // for each entity (sender, factory, paymaster), hold the valid slot addresses
  const entitySlots: { [addr: string]: Set<string> } = {}

  tracerResults.keccak.forEach(k => {
    const value = keccak256(k).slice(2)
    stakeInfoArray.forEach(info => {
      const addr = info?.addr?.toLowerCase()
      if (addr == null) return
      const addrPadded = hexZeroPad(addr.toLowerCase(), 32)
      if (entitySlots[addr] == null) {
        entitySlots[addr] = new Set<string>()
      }

      const currentEntitySlots = entitySlots[addr]
      if (k.startsWith(addrPadded)) {
        // console.log('added mapping (balance) slot', value)
        currentEntitySlots.add(value)
      }
      if (k.length === 130 && currentEntitySlots.has(k.slice(-64))) {
        // console.log('added double-mapping (allowance) slot', value)
        currentEntitySlots.add(value)
      }
    })
  });

  ['factory', 'account', 'paymaster'].forEach((entity, index) => {
    const entStakes = stakeInfoArray[index]
    const entityAddr = entStakes?.addr ?? ''
    const currentNumLevel = tracerResults.numberLevels[index]
    const opcodes = currentNumLevel.opcodes
    const access = currentNumLevel.access

    requireCond(!(currentNumLevel.oog ?? false),
      `${entity} internally reverts on oog`, ValidationErrors.OpcodeValidation)
    Object.keys(opcodes).forEach(opcode =>
      requireCond(!bannedOpCodes.has(opcode), `${entity} uses banned opcode: ${opcode}`, ValidationErrors.OpcodeValidation)
    )
    if (entity === 'factory') {
      requireCond((opcodes.CREATE2 ?? 0) <= 1, `${entity} with too many CREATE2`, ValidationErrors.OpcodeValidation)
    } else {
      requireCond(opcodes.CREATE2 == null, `${entity} uses banned opcode: CREATE2`, ValidationErrors.OpcodeValidation)
    }

    Object.entries(access).forEach(([addr, {
      reads,
      writes
    }]) => {
      // console.log('testing access addr', addr, 'op.sender=', userOp.sender)
      if (addr === sender) {
        // allowed to access sender's storage
        return
      }
      let requireStakeSlot: string | undefined
      [...Object.keys(writes), ...Object.keys(reads)].forEach(slot => {
        // slot associated with sender is always allowed (e.g. token.balanceOf(sender)
        if (entitySlots[sender].has(slot)) {
          return
        }
        if (entitySlots[entityAddr]?.has(slot)) {
          // accessing a slot associated with entityAddr (e.g. token.balanceOf(paymaster)
          requireStakeSlot = slot
        } else if (addr === entityAddr) {
          // accessing storage member entity
          requireStakeSlot = slot
        } else {
          // accessing arbitrary storage of another contract
          const readWrite = Object.keys(writes).includes(addr) ? 'write to' : 'read from'
          requireCond(false, `${entity} has forbidden ${readWrite} addr ${addr} slot ${slot}`, ValidationErrors.OpcodeValidation, { [entity]: entStakes?.addr })
        }
      })
      if (requireStakeSlot != null) {
        if (entStakes == null) {
          throw new Error(`internal: ${entity} no entStake, but has storage accesses in ${JSON.stringify(access)}`)
        }
        requireCond(BigNumber.from(1).lt(entStakes.stake) && BigNumber.from(1).lt(entStakes.unstakeDelaySec),
          `unstaked ${entity} accessed addr ${addr} slot ${requireStakeSlot}`, ValidationErrors.OpcodeValidation, { [entity]: entStakes?.addr })

        // TODO: check real minimum stake values
      }
    })
  })
}
