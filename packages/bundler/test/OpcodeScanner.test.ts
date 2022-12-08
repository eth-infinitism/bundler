import { EntryPoint, EntryPoint__factory, UserOperationStruct } from '@account-abstraction/contracts'
import { hexConcat, hexlify, parseEther, resolveProperties } from 'ethers/lib/utils'
import { expect } from 'chai'
import {
  TestOpcodesAccount,
  TestOpcodesAccount__factory,
  TestOpcodesAccountFactory,
  TestOpcodesAccountFactory__factory
} from '../src/types'
import { isGeth, parseScannerResult } from '../src/parseScannerResult'
import { BundlerCollectorReturn, bundlerCollectorTracer, ExitInfo } from '../src/BundlerCollectorTracer'
import { JsonRpcProvider } from '@ethersproject/providers'
import { BigNumber, ethers } from 'ethers'
import { debug_traceCall } from '../src/GethTracer'
import { decodeErrorReason } from '@account-abstraction/utils'

/**
 * wrapper for "parseScannerResult" to run these tests (duplicate of ValidationManageR)
 */
export async function testParseScannerResult (userOp1: UserOperationStruct, entryPoint: EntryPoint): Promise<BundlerCollectorReturn> {
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

describe('opcode banning', () => {
  let deployer: TestOpcodesAccountFactory
  let paymaster: TestOpcodesAccount
  let entryPoint: EntryPoint

  async function testUserOp (validateRule: string = '', initFunc?: string, pmRule?: string): Promise<BundlerCollectorReturn> {
    return await testParseScannerResult(await createTestUserOp(validateRule, initFunc, pmRule), entryPoint)
  }

  async function createTestUserOp (validateRule: string = '', initFunc?: string, pmRule?: string): Promise<UserOperationStruct> {
    if (initFunc === undefined) {
      initFunc = deployer.interface.encodeFunctionData('create', [''])
    }

    const initCode = hexConcat([
      deployer.address,
      initFunc
    ])
    const paymasterAndData = pmRule == null ? '0x' : hexConcat([paymaster.address, Buffer.from(pmRule)])
    let signature: string
    if (validateRule.startsWith('deadline:')) {
      signature = hexlify(validateRule.slice(9))
    } else {
      signature = hexlify(Buffer.from(validateRule))
    }
    const sender = await deployer.callStatic.create('')
    return {
      sender,
      initCode,
      signature,
      nonce: 0,
      paymasterAndData,
      callData: '0x',
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0
    }
  }

  before(async function () {
    const ethersSigner = ethers.provider.getSigner()
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    paymaster = await new TestOpcodesAccount__factory(ethersSigner).deploy()
    await entryPoint.depositTo(paymaster.address, { value: parseEther('0.1') })
    await paymaster.addStake(entryPoint.address, { value: parseEther('0.1') })
    deployer = await new TestOpcodesAccountFactory__factory(ethersSigner).deploy()

    if (!await isGeth(ethers.provider)) {
      console.log('WARNING: opcode banning tests can only run with geth')
      this.skip()
    }
  })
  it('should accept plain request', async () => {
    await testUserOp()
  })
  it('test sanity: reject unknown rule', async () => {
    expect(await testUserOp('<unknown-rule>')
      .catch(e => e.message)).to.match(/unknown rule/)
  })
  it('should fail with bad opcode in ctr', async () => {
    expect(await testUserOp('',
      deployer.interface.encodeFunctionData('create', ['coinbase']))
      .catch(e => e.message)).to.match(/account uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in paymaster', async () => {
    expect(await testUserOp('', undefined, 'coinbase')
      .catch(e => e.message)).to.match(/paymaster uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in validation', async () => {
    expect(await testUserOp('blockhash')
      .catch(e => e.message)).to.match(/account uses banned opcode: BLOCKHASH/)
  })
  it('should fail if creating too many', async () => {
    expect(await testUserOp('create2')
      .catch(e => e.message)).to.match(/initCode with too many CREATE2/)
  })
  it('should succeed if referencing self token balance', async () => {
    await testUserOp('balance-self')
  })
  it('should fail if referencing other token balance', async () => {
    expect(await testUserOp('balance-1').catch(e => e)).to.match(/forbidden read/)
  })
})
