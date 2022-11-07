import { TracerTest, TracerTest__factory } from '../src/types'
import { ethers } from 'hardhat'
import { debug_traceCall } from '../src/GethTracer'
import { hexlify, keccak256 } from 'ethers/lib/utils'
import { expect } from 'chai'
import { BundlerCollectorReturn, bundlerCollectorTracer } from '../src/BundlerCollectorTracer'

const provider = ethers.provider
const signer = provider.getSigner()

describe('tracer', () => {
  let tester: TracerTest
  before(async () => {
    tester = await new TracerTest__factory(signer).deploy()
    await tester.deployTransaction.wait()
  })

  it('should collect call params', async () => {
    const testKeccalCallData = tester.interface.encodeFunctionData('callWithValue')

    const tracer = bundlerCollectorTracer
    // copied from https://geth.ethereum.org/docs/rpc/ns-debug#debug_tracetransaction
    // tracer = '{data: [], fault: function(log) {}, step: function(log) { if(log.op.toString() == "CALL") this.data.push(log.stack.peek(0)); }, result: function() { return this.data; }}'

    const account = await provider.listAccounts().then(list => list[0])
    const tx = {
      from: account,
      to: tester.address,
      gasPrice: hexlify(1e9),
      data: testKeccalCallData
    }
    console.log('tx call ret=', await provider.call(tx))
    // const ret = await execAndTrace(provider, tx, { tracer, })
    const ret = await debug_traceCall(provider, tx, { tracer }) as BundlerCollectorReturn
    // console.log('ret=',  util.inspect({...ret, opcodes: {} } , false, 10,true))

    expect(ret.keccak.length).to.equal(1)
    const kdata = ret.keccak[0]
    const hash = keccak256(kdata).replace(/^0x/, '')
    console.log('hash=', hash)
    const addr = tester.address.toLowerCase()
    // our sample reads normal slot, writes to a mapping and then write to a normal slot
    expect(ret.access[addr].reads['1']).to.equal(1)
    expect(ret.access[addr].writes[hash]).to.equal(1)
    expect(ret.access[addr].writes['0']).to.equal(1)

    // 2 keccak calls (hardhat call it "SHA3")
    expect(ret.opcodes.KECCAK256).to.equal(2)
    // 2 returns (one is inner call)
    expect(ret.opcodes.RETURN).to.equal(2)
  })

  it('should report GAS opcode (but not before CALL)', async () =>{

    const testCallGas = tester.interface.encodeFunctionData('testCallGas')
    const ret: BundlerCollectorReturn = await debug_traceCall(provider, {
      to: tester.address,
      data: testCallGas
    }, {
      tracer: bundlerCollectorTracer
    })
    expect(ret.opcodes['GAS']).to.eq(1)

    //this call use GAS, but it is ignored, just before '*CALL'
    const ret1: BundlerCollectorReturn = await debug_traceCall(provider, {
      to: tester.address,
      data: tester.interface.encodeFunctionData('callWithValue')
    }, {
      tracer: bundlerCollectorTracer
    })
    expect(ret.opcodes['GAS']).to.eq(undefined)
  })

  it('should collect reverted call info', async () => {
    const revertingCallData = tester.interface.encodeFunctionData('callRevertingFunction', [false])

    const tracer = bundlerCollectorTracer
    const ret = await debug_traceCall(provider, {
      to: tester.address,
      data: revertingCallData
    }, {
      tracer
    }) as BundlerCollectorReturn

    expect(ret.logs).to.contains('failure')
    // todo: tests for failures. (e.g. detect oog)
  })
})
