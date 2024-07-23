import { TracerTest, TracerTest__factory } from '../src/types'
import { ethers } from 'hardhat'
import { debug_traceCall } from '@account-abstraction/validation-manager/src/GethTracer'
import { expect } from 'chai'
import { BundlerTracerResult, bundlerCollectorTracer } from '@account-abstraction/validation-manager/src/BundlerCollectorTracer'
import { BytesLike } from 'ethers'

const provider = ethers.provider
const signer = provider.getSigner()

describe('#bundlerCollectorTracer', () => {
  let tester: TracerTest
  before(async function () {
    const ver: string = await (provider as any).send('web3_clientVersion')
    if (ver.match('go1') == null) {
      console.warn('\t==WARNING: test requires debug_traceCall on Geth (go-ethereum) node. ver=' + ver)
      this.skip()
      return
    }
    tester = await new TracerTest__factory(signer).deploy()
    await tester.deployTransaction.wait()
  })

  it('should count opcodes on depth>1', async () => {
    const ret = await traceExecSelf(tester.interface.encodeFunctionData('callTimeStamp'), false, true)
    const execEvent = tester.interface.decodeEventLog('ExecSelfResult', ret.logs[0].data, ret.logs[0].topics)
    expect(execEvent.success).to.equal(true)
    expect(ret.callsFromEntryPoint[0].opcodes.TIMESTAMP).to.equal(1)
  })

  it('should not count opcodes on depth==1', async () => {
    const ret = await traceCall(tester.interface.encodeFunctionData('callTimeStamp'))
    expect(ret.callsFromEntryPoint[0]?.opcodes.TIMESTAMP).to.be.undefined
    // verify no error..
    expect(ret.debug.toString()).to.not.match(/REVERT/)
  })

  async function traceCall (functionData: BytesLike): Promise<BundlerTracerResult> {
    const ret: BundlerTracerResult = await debug_traceCall(provider, {
      to: tester.address,
      data: functionData
    }, {
      tracer: bundlerCollectorTracer
    })
    return ret
  }

  // wrap call in a call to self (depth+1)
  async function traceExecSelf (functionData: BytesLike, useNumber = true, extraWrapper = false): Promise<BundlerTracerResult> {
    const execTestCallGas = tester.interface.encodeFunctionData('execSelf', [functionData, useNumber])
    if (extraWrapper) {
      // add another wreapper for "execSelf" (since our tracer doesn't collect stuff from top-level method
      return await traceExecSelf(execTestCallGas, useNumber, false)
    }
    const ret = await traceCall(execTestCallGas)
    return ret
  }

  describe('#traceExecSelf', () => {
    it('should revert', async () => {
      const ret = await traceExecSelf('0xdead', true, true)
      expect(ret.debug.toString()).to.match(/execution reverted/)
      expect(ret.logs.length).to.equal(1)
      const log = tester.interface.decodeEventLog('ExecSelfResult', ret.logs[0].data, ret.logs[0].topics)
      expect(log.success).to.equal(false)
    })
    it('should call itself', async () => {
      // sanity check: execSelf works and call itself (even recursively)
      const innerCall = tester.interface.encodeFunctionData('doNothing')
      const execInner = tester.interface.encodeFunctionData('execSelf', [innerCall, false])
      const ret = await traceExecSelf(execInner, true, true)
      expect(ret.logs.length).to.equal(2)
      ret.logs.forEach(log => {
        const logParams = tester.interface.decodeEventLog('ExecSelfResult', log.data, log.topics)
        expect(logParams.success).to.equal(true)
      })
    })
  })

  it('should report direct use of GAS opcode', async () => {
    const ret = await traceExecSelf(tester.interface.encodeFunctionData('testCallGas'), false)
    expect(ret.callsFromEntryPoint['0'].opcodes.GAS).to.eq(1)
  })

  it('should ignore gas used as part of "call"', async () => {
    // call the "testKeccak" function as a sample inner function
    const doNothing = tester.interface.encodeFunctionData('doNothing')
    const callDoNothing = tester.interface.encodeFunctionData('execSelf', [doNothing, false])
    const ret = await traceExecSelf(callDoNothing, false)
    expect(ret.callsFromEntryPoint['0'].opcodes.GAS).to.be.undefined
  })

  it('should collect traces only until BeginExecution event', async () => {
    // the method calls "callTimeStamp" 3 times, but should stop tracing after 2 times..
    const callStopTracing = tester.interface.encodeFunctionData('testStopTracing')
    const ret = await traceCall(callStopTracing)
    expect(ret.callsFromEntryPoint.length).to.eql(2)
  })
})
