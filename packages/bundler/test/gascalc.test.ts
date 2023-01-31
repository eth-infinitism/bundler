import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { DeterministicDeployer } from '@account-abstraction/sdk'
import { ethers } from 'hardhat'
import { debug_traceCall } from '../src/GethTracer'
import {
  TestSizeAccount,
  EpWrapper, EpWrapper__factory,
  TestSizeAccount__factory, TestSizeFactory, TestSizeFactory__factory, TestSizePaymaster, TestSizePaymaster__factory
} from '../src/types'
import { hexConcat, hexlify, parseEther } from 'ethers/lib/utils'
import { UserOperation } from '../src/modules/moduleUtils'
import { AddressZero } from '@account-abstraction/utils'
import { traceUserOpGas } from './TraceInnerCall'
import { expect } from 'chai'

const provider = ethers.provider
const ethersSigner = provider.getSigner()

const factors = {
  offset:0,
  callDataFactory: 3
}
function calcPreverificationGas(op: UserOperation) {
  return factors.offset +
    op.callData.length * factors.callDataFactory
}
const DefaultsForUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGasLimit: 0,
  verificationGasLimit: 1e6, // default verification gas. will add create2 cost (3200+200*length) if initCode exists
  preVerificationGas: 21000, // should also cover calldata cost.
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 1e9,
  paymasterAndData: '0x',
  signature: '0x'
}

interface CalcParams {
  initLen?: number
  pmLen?: number
  pmCtxLen?: number
  sigLen?: number
  callDataLen?: number
}

describe('calculate preVerificationGas', function () {

  let entryPoint: EntryPoint
  let factory: TestSizeFactory
  let paymaster: TestSizePaymaster
  let beneficiary = ethersSigner.getAddress()
  let sender: TestSizeAccount

  let epWrapper: EpWrapper
  before(async () => {
    DeterministicDeployer.init(provider)

    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    epWrapper = await new EpWrapper__factory(ethersSigner).deploy()
    // entryPoint = EntryPoint__factory.connect(await DeterministicDeployer.deploy(new EntryPoint__factory(), 0, []), ethersSigner)
    factory = await new TestSizeFactory__factory(ethersSigner).deploy()
    paymaster = await new TestSizePaymaster__factory(ethersSigner).deploy()
    sender = await new TestSizeAccount__factory(ethersSigner).deploy()

    const sig1 = sender.interface.encodeFunctionData('called')
    const methodsig = '0x50f9b6cd'
    await ethersSigner.sendTransaction({
      to: sender.address,
      data: methodsig
    })

    const counterFactualWallet = await factory.callStatic.deploy(0, '0x')
    await entryPoint.depositTo(counterFactualWallet, { value: parseEther('1') })

    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
    await entryPoint.depositTo(sender.address, { value: parseEther('1') })

    // expect(await isGeth(provider), await provider.send('web3_clientVersion', [])).to.be.true

  })

  describe('get network base gas constants', () => {
    it('get network base constants', async () => {
      const base = await provider.estimateGas({
        to: AddressZero,
        data: '0x'
      })
      const zero = await provider.estimateGas({
        to: AddressZero,
        data: '0x00'
      })
      const nonzero = await provider.estimateGas({
        to: AddressZero,
        data: '0x01'
      })

      console.log('base=', base.toNumber())
      console.log('zero=', zero.sub(base).toNumber())
      console.log('nonzero=', nonzero.sub(base).toNumber())
    })
  })
  describe('sanity (check that debug_traceCall works the same (and collect gas) as direct handleOp and events', () => {
    it('should initCode sizes', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ initLen: 0 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ initLen: 1 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ initLen: 100 }))
    })
    it('should pm sizes', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 0 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 1 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 100 }))
    })
    it('should calldata sizes', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ callDataLen: 0 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ callDataLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ callDataLen: 100 }))
    })

    it('should sig sizes', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ sigLen: 0 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ sigLen: 1 }))
      await traceUserOpGas(entryPoint, await buildUserOp({ sigLen: 100 }))
    })
  })

  describe('#traceUserOpGas', () => {
    it('should calculate same gas as real transaction', async () => {
      const params = {}
      const op = await buildUserOp(params)
      const ret = await traceUserOpGas(entryPoint, op, true)
    })

    it('should revert if userop causes revert', async () => {
      const params = {}
      let op = await buildUserOp(params)
      op.callGasLimit = '0x'.padEnd(66, 'f')
      expect(await traceUserOpGas(entryPoint, op).catch(e => e.message)).to.match(/AA94 gas values overflow/, JSON.stringify(op, null, 2))
    })

    it('should be invariant regardless of op size', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ initLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 100 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ sigLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ sigLen: 100 }), true)
    })
    it('should be invariant regardless of context length', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ pmCtxLen: 0 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmCtxLen: 100 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmCtxLen: 1000 }), true)
    })
  })

  it('should bombard huge post', async () => {
    let op = await buildUserOp({pmCtxLen: 1e3})
    // op.callGasLimit = '0xfffffffffffffffffffffffffffffffffffffff'
    let ret = await entryPoint.callStatic.simulateValidation(op, {gasLimit: 1e6})
      .catch(e=>e.errorName+' '+e.errorArgs)
    console.log('ret=', ret)
  })

  describe.only('actual gascalc', () => {
    it('should calc gas', async function () {
      this.timeout(20000)
      for (let key of ['initLen', 'pmLen', 'pmCtxLen', 'sigLen', 'callDataLen']) {
        var lastPre: any = undefined
        var lastdiff: any = undefined
        var lastsize: any = undefined
        const sizes: number[] = [null] as any
        for (let i = 0; i < 200; i++) {
          sizes.push(i)
        }
        for (let i = 200; i < 1000; i += 32) {
          sizes.push(i)
        }

        console.log('scanning sizes 0..65 in step 1, and 65..1000 in step 32')

        for (let size of sizes) {
          const ret = await traceUserOpGas(entryPoint, await buildUserOp({ [key]: size }))
          //pre is actual preVerificationGas.
          // we remove callDataGas, which is easily calculate-able off-chain
          const pre = ret.gasUsed - ret.gasPaid - ret.callDataGas
          //diff is sizediff - compared prev size size-1 (or size-32)
          const diff = pre - lastPre
          if (diff != lastdiff|| size>950) {
            console.log(key, 'size=', size, size - lastsize, 'diff=', pre, pre - lastPre)
            lastdiff = diff
            lastsize = size
          }
          lastPre = pre
        }
      }
    })
  })

  function pad (len: number, val = 1) {
    return hexlify(Buffer.alloc(len, val))
  }

  async function buildUserOp (params: CalcParams): Promise<UserOperation> {
    let op: UserOperation = {
      ...DefaultsForUserOp,
      verificationGasLimit: 1e6,
      callGasLimit: 1e6,
      maxFeePerGas: 1,
    }
    if (params.initLen != null) {
      const salt = 0
      let initData = pad(params.initLen)
      op.initCode = hexConcat([factory.address, factory.interface.encodeFunctionData('deploy', [salt, initData])])
      op.sender = await factory.callStatic.deploy(salt, initData)
    } else {
      op.sender = sender.address
    }

    if (params.pmCtxLen != null) {
      op.paymasterAndData = paymaster.address
      op.nonce = params.pmCtxLen
    }
    if (params.pmLen != null) {
      op.paymasterAndData = hexConcat([paymaster.address, pad(params.pmLen)])
    }
    op.signature = pad(params.sigLen ?? 0)
    op.callData = pad(params.callDataLen ?? 0)
    return op
  }

  async function checkGas (params: CalcParams): Promise<number> {
    const op = await buildUserOp(params)
    const ret = await traceUserOpGas(entryPoint, op)

    // console.log('ret=', ret)
    return ret.gasUsed
  }

  async function hist1 (key: keyof CalcParams, max: number) {
    const skipOne = true
    let hist: { [key: number]: number } = {}
    let last = undefined

    if (!skipOne) {

      for (let i = 0; i < max; i += 1) {
        const gas = await checkGas({ [key]: i })
        if (last != null) {
          const delta = gas - last
          hist [i % 32] = (hist[i % 32] ?? 0) + delta
        }
        last = gas
      }
      console.log(key, 'hist=', JSON.stringify(hist)
        .replace(/"(\d+)"/g, '$1')
        .replace(/\d+:0,?/g, ''))
    }
    last = undefined
    hist = {}
    for (let i = 0; i < max; i += 32) {
      const gas = await checkGas({ [key]: i })
      if (last != null) {
        const delta = gas - last
        hist [i] = (hist[i] ?? 0) + delta
      }
      last = gas
    }
    console.log(key, '32byte=', Object.values(hist))
  }
})
