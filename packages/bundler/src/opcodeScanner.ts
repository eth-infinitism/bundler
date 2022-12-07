import { EntryPoint, UserOperationStruct } from '@account-abstraction/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { hexZeroPad, keccak256, resolveProperties } from 'ethers/lib/utils'
import { BigNumber, ethers } from 'ethers'
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo, MethodInfo } from './BundlerCollectorTracer'
import { debug_traceCall } from './GethTracer'
import { decodeErrorReason } from '@account-abstraction/utils'
import { requireCond } from './utils'
import { inspect } from 'util'

import Debug from 'debug'
import { UserOperation } from './modules/moduleUtils'
import { ValidationErrors } from './modules/ValidationManager'
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
 * perform opcode scanning rules on the given UserOperation.
 * throw a detailed exception on failure.
 * Uses eth_traceCall of geth
 */
export async function opcodeScanner (userOp1: UserOperationStruct, entryPoint: EntryPoint): Promise<BundlerCollectorReturn> {
  const provider = entryPoint.provider as JsonRpcProvider
  const userOp = await resolveProperties(userOp1)
  const simulateCall = entryPoint.interface.encodeFunctionData('simulateValidation', [userOp])

  const simulationGas = BigNumber.from(userOp.preVerificationGas).add(userOp.verificationGasLimit)

  const result: BundlerCollectorReturn = await debug_traceCall(provider, {
    from: ethers.constants.AddressZero,
    to: entryPoint.address,
    data: simulateCall,
    gasLimit: simulationGas
  }, { tracer: bundlerCollectorTracer })

  if (result.calls.length >= 1) {
    const last = result.calls[result.calls.length - 1]
    if (last.type === 'REVERT') {
      const data = (last as ExitInfo).data
      const sighash = data.slice(0, 10)
      try {
        // find sighash in errors of entryPoint (FailedOp, SimulationResult, etc)
        const errorFragment = entryPoint.interface.getError(sighash)

        const errParams = entryPoint.interface.decodeErrorResult(errorFragment, data)
        const errName = `${errorFragment.name}(${errParams.toString()})`
        if (!errorFragment.name.includes('Result')) {
          // a real error, not a result.
          throw new Error(errName)
        }
      } catch (e: any) {
        // not a known error of EntryPoint (probably, only Error(string), since FailedOp is handled above)
        const err = decodeErrorReason(data)
        throw new Error(err != null ? err.message : data)
      }
    }
  }

  parseScannerResult(userOp, result, entryPoint)
  return result
}

export function parseScannerResult (userOp: UserOperation, result: BundlerCollectorReturn, entryPoint: EntryPoint): void {
  debug('=== simulation result:', inspect(result, true, 10, true))
  // todo: block access to no-code addresses (might need update to tracer)

  const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'GAS', 'CREATE', 'COINBASE', 'SELFDESTRUCT'])

  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (Object.values(result.numberLevels).length < 2) {
    // console.log('calls=', result.calls.map(x=>JSON.stringify(x)).join('\n'))
    // console.log('debug=', result.debug)
    throw new Error('Unexpected traceCall result: no NUMBER opcodes, and not REVERT')
  }
  const handleOpsMethodSig = entryPoint.interface.getSighash('innerHandleOp')
  result.calls.forEach(call => {
    if (call.type.includes('CALL')) {
      const call1 = call as MethodInfo
      requireCond(entryPoint.address !== call1.to || call1.method !== handleOpsMethodSig.toString(),
        'Must not make recursive call to handleOps', ValidationErrors.OpcodeValidation)
    }
  })

  const accountSlots = new Set<string>()
  const senderPadded = hexZeroPad(userOp.sender, 32).toLowerCase()
  result.keccak.forEach(k => {
    const value = keccak256(k).slice(2)
    if (k.startsWith(senderPadded)) {
      // console.log('added mapping (balance) slot', value)
      accountSlots.add(value)
    }
    if (k.length === 130 && accountSlots.has(k.slice(-64))) {
      // console.log('added double-mapping (allowance) slot', value)
      accountSlots.add(value)
    }
  });

  ['factory', 'account', 'paymaster'].forEach((entity, index) => {
    const opcodes = result.numberLevels[index].opcodes
    const access = result.numberLevels[index].access
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
      if (addr === userOp.sender.toLowerCase()) {
        // allowed to access sender
        return
      }
      Object.keys(writes).forEach(slot => requireCond(accountSlots.has(slot), `${entity} has forbidden write to addr ${addr}  slot ${slot}`), ValidationErrors.OpcodeValidation)
      Object.keys(reads).forEach(slot => requireCond(accountSlots.has(slot), `${entity} has forbidden read from addr ${addr}  slot ${slot}`), ValidationErrors.OpcodeValidation)
    })

    // TODO: need to check "staked" rules: allow entity to access storage of itself
  })
}
