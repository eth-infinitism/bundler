import { EntryPoint, UserOperationStruct } from '@account-abstraction/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { hexZeroPad, keccak256, resolveProperties } from 'ethers/lib/utils'
import { BigNumber, ethers } from 'ethers'
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo } from './BundlerCollectorTracer'
import { debug_traceCall } from './GethTracer'
import { decodeErrorReason } from '@account-abstraction/utils'
import { requireCond } from './utils'

import Debug from 'debug'

const debug = Debug('aa.handler.opcodes')

export async function isGeth (provider: JsonRpcProvider): Promise<boolean> {
  let p = provider.send as any
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
export async function opcodeScanner(userOp1: UserOperationStruct, entryPoint: EntryPoint) {

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

  debug('=== simulation result:', result)
  // todo: validate keccak, access
  // todo: block access to no-code addresses (might need update to tracer)

  const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'SELFBALANCE', 'BALANCE', 'ORIGIN', 'GAS', 'CREATE', 'COINBASE'])

  const paymaster = (userOp.paymasterAndData?.length ?? 0) >= 42 ? userOp.paymasterAndData.toString().slice(0, 42) : undefined
  if (Object.values(result.numberLevels).length < 2) {
    // console.log('calls=', result.calls.map(x=>JSON.stringify(x)).join('\n'))
    // console.log('debug=', result.debug)
    if (result.calls.length >= 1) {
      const last = result.calls[result.calls.length - 1]
      if (last.type === 'REVERT') {

        let data = (last as ExitInfo).data
        let err = decodeErrorReason(data)
        throw new Error(err != null ? err.message : data)
      }
    }
    throw new Error('unexpected traceCall result: no tracer or no NUMBER opcodes')
  }
  const validateOpcodes = result.numberLevels['0'].opcodes
  const validatePaymasterOpcodes = result.numberLevels['1'].opcodes
  // console.log('debug=', result.debug.join('\n- '))
  Object.keys(validateOpcodes).forEach(opcode =>
    requireCond(!bannedOpCodes.has(opcode), `account uses banned opcode: ${opcode}`, 32501)
  )
  Object.keys(validatePaymasterOpcodes).forEach(opcode =>
    requireCond(!bannedOpCodes.has(opcode), `paymaster uses banned opcode: ${opcode}`, 32501, { paymaster })
  )
  if (userOp.initCode.length > 2) {
    requireCond((validateOpcodes.CREATE2 ?? 0) <= 1, 'initCode with too many CREATE2', 32501)
  } else {
    requireCond((validateOpcodes.CREATE2 ?? 0) < 1, 'banned opcode: CREATE2', 32501)
  }
  requireCond((validatePaymasterOpcodes.CREATE2 ?? 0) < 1, 'paymaster uses banned opcode: CREATE2', 32501, { paymaster })

  const accountSlots = new Set<string>()
  const senderPadded = hexZeroPad(userOp.sender, 32).toLowerCase()
  result.keccak.forEach(k => {
    let value = keccak256(k).slice(2)
    if (k.startsWith(senderPadded)) {
      // console.log('added mapping (balance) slot', value)
      accountSlots.add(value)
    }
    if (k.length == 130 && accountSlots.has(k.slice(-64))) {
      // console.log('added double-mapping (allowance) slot', value)
      accountSlots.add(value)
    }
  })
  Object.entries(result.numberLevels[0].access!).forEach(([addr, {
    reads,
    writes
  }]) => {
    // console.log('testing access addr', addr, 'op.sender=', userOp.sender)
    if (addr == userOp.sender.toLowerCase()) {
      //allowed to access itself
      return
    }
    Object.keys(writes).forEach(slot => requireCond(accountSlots.has(slot), `forbidden write to addr ${addr}  slot ${slot}`))
    Object.keys(reads).forEach(slot => requireCond(accountSlots.has(slot), `forbidden read from addr ${addr}  slot ${slot}`))
  })
  return result
}
