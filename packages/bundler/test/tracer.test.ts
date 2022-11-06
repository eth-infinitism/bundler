import { TracerTest, TracerTest__factory } from '../src/types'
import { ethers } from 'hardhat'
import { execAndTrace, LogContext, LogDb, LogStep, LogTracer, traceCall } from '../src/eth_tracer'
import { arrayify, hexConcat, hexlify, hexZeroPad, keccak256 } from 'ethers/lib/utils'
import fs from 'fs'
import { expect } from 'chai'

const provider = ethers.provider
const signer = provider.getSigner()
describe('tracer', () => {

  let tester: TracerTest
  before(async () => {
    tester = await new TracerTest__factory(signer).deploy()
  })

  class MyTracer implements LogTracer {
    logs: Array<string> = []
    afterKeccak = false

    fault (log: LogStep, db: LogDb): void {
    }

    result (ctx: LogContext, db: LogDb): any {
      console.log('ret=', this.logs)
      return this.logs
    }

    step (log: LogStep, db: LogDb): any {
      if (this.afterKeccak) {
        let tophex = hexlify(BigInt(log.stack.peek(0).String()))
        console.log('top=', tophex)
        this.logs.push(tophex)
        this.afterKeccak = false
      }
      if (log.op.toString() == 'SHA3') {
        const ofs = parseInt(log.stack.peek(0).String())
        const len = parseInt(log.stack.peek(1).String())
        let mem = '0x' + log.memory.slice(ofs, ofs + len)
        this.afterKeccak = true
        console.log('mem=', mem)
        console.log('keccak=', ethers.utils.keccak256(mem))
      }
    }
  }

  function loadTracer(): string {
    return fs.readFileSync(__dirname+'/tracertest.js', 'ascii')
      .replace(/\/\/.*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '').trim()
      .replace(/^module.exports\s*=\s*/,'')
      .replace(/\n\s*\n/g, "\n").trim()
  }

  it('should collect call params', async () => {
    let testKeccalCallData = tester.interface.encodeFunctionData('callWithValue')

    const tracer = loadTracer()
    //copied from https://geth.ethereum.org/docs/rpc/ns-debug#debug_tracetransaction
    // tracer = '{data: [], fault: function(log) {}, step: function(log) { if(log.op.toString() == "CALL") this.data.push(log.stack.peek(0)); }, result: function() { return this.data; }}'

    const ret = await traceCall(provider, {
      to: tester.address,
      data: testKeccalCallData,
    }, {
      tracer,
    })

    expect(ret.keccak.length).to.equal(1)
    const [k1, k2] = ret.keccak[0]
    const hash = keccak256(hexConcat([hexZeroPad('0x'+k1,32), hexZeroPad('0x'+k2,32)])).replace('0x','')
    expect(ret.slots[hash]).to.equal(1)
    //one read (of normal member)
    expect(ret.reads[tester.address.toLowerCase()]).to.equal(1)
    //2 writes(one to mapping, one to normal member)
    expect(ret.writes[tester.address.toLowerCase()]).to.equal(2)

    //2 keccak calls (hardhat call it "SHA3")
    expect(ret.opcodes['KECCAK256']).to.equal(2)
    expect(ret.opcodes['RETURN']).to.equal(1)
  })

  it.skip('should collect reverted call info', async () => {
    let revertingCallData = tester.interface.encodeFunctionData('callRevertingFunction')

    const tracer = loadTracer()

    const ret = await execAndTrace(provider, {
      to: tester.address,
      data: revertingCallData,
    }, {
      tracer,
    },true)

    expect(ret.keccak.length).to.equal(1)
    const [k1, k2] = ret.keccak[0]
    const hash = keccak256(hexConcat([hexZeroPad('0x'+k1,32), hexZeroPad('0x'+k2,32)])).replace('0x','')
    expect(ret.slots[hash]).to.equal(1)
    //one read (of normal member)
    expect(ret.reads[tester.address.toLowerCase()]).to.equal(1)
    //2 writes(one to mapping, one to normal member)
    expect(ret.writes[tester.address.toLowerCase()]).to.equal(2)

    //2 keccak calls (hardhat call it "SHA3")
    expect(ret.opcodes['KECCAK256']).to.equal(2)
    expect(ret.opcodes['RETURN']).to.equal(1)
  })
})
