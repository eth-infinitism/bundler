import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { EntryPointInterface } from '@account-abstraction/contracts/types/EntryPoint'
import { DeterministicDeployer } from '@account-abstraction/sdk'
import { ethers } from 'hardhat'
import { debug_traceCall, LogCallFrame, LogContext, LogDb, LogFrameResult, LogStep, LogTracer } from '../src/GethTracer'
import {
  TestSizeAccount,
  EpWrapper, EpWrapper__factory,
  TestSizeAccount__factory, TestSizeFactory, TestSizeFactory__factory, TestSizePaymaster, TestSizePaymaster__factory
} from '../src/types'
import { arrayify, hexConcat, hexlify, parseEther } from 'ethers/lib/utils'
import { UserOperation } from '../src/modules/moduleUtils'
import { AddressZero, decodeErrorReason } from '@account-abstraction/utils'
import { traceUserOpGas } from './TraceInnerCall'
import { expect } from 'chai'

const provider = ethers.provider
const ethersSigner = provider.getSigner()

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
    console.log('sig1=', sig1)
    const methodsig = '0x50f9b6cd'
    console.log('sig2=', methodsig)
    await ethersSigner.sendTransaction({
      to: sender.address,
      data: methodsig
    })

    console.log('called=', await provider.call({
      to: sender.address,
      data: methodsig
    }))
    const counterFactualWallet = await factory.callStatic.deploy(0, '0x')
    await entryPoint.depositTo(counterFactualWallet, { value: parseEther('1') })

    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
    await entryPoint.depositTo(sender.address, { value: parseEther('1') })

    // expect(await isGeth(provider), await provider.send('web3_clientVersion', [])).to.be.true

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

    console.log('ret=', ret)
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

  describe('#traceUserOpGas', () => {
    it('should calculate same gas as real transaction', async () => {
      const params = {}
      const op = await buildUserOp(params)
      const ret = await traceUserOpGas(entryPoint, op, true)
    })

    it('should revert if userop causes revert', async () => {
      const params = {}
      const op = await buildUserOp(params)
      op.paymasterAndData = '0xdead'
      expect(await traceUserOpGas(entryPoint, op, true).catch(e => e.message)).to.match(/AA93 invalid paymasterAndData/)
    })

    it('should be invariant regardless of op size', async () => {
      await traceUserOpGas(entryPoint, await buildUserOp({ initLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 1 }), true)
      await traceUserOpGas(entryPoint, await buildUserOp({ pmLen: 100 }), true)
    })
  })

  describe('sanity', () => {
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
  it('check callData gas', async function () {
    this.timeout(10000)
    let a: keyof CalcParams
    a = 'callDataLen'
    let lastgas = 0
    await hist1('initLen', 300)
    await hist1('pmLen', 300)
    await hist1('sigLen', 300)
    await hist1('callDataLen', 300)
    for (let i = 8; i <= 500; i += 1) {
      let len = i == 8 ? 0 : i
      const gas = await checkGas({ sigLen: len })
      const delta = gas - lastgas
      lastgas = gas
      // console.log('calldata', len, gas, delta)
    }
  })
  it('should calc cost', async () => {
    const op = await buildUserOp({ callDataLen: 1 })
    // const tx = await entryPoint.populateTransaction.handleOps([op], beneficiary)
    const tx = await epWrapper.populateTransaction.callEp(entryPoint.address, op)
    const {
      gas,
      failed,
      returnValue
    } = await debug_traceCall(provider, tx, { disableStack: true })
    console.log({
      gas,
      failed,
      returnValue
    })
    await ethersSigner.sendTransaction(tx)
    const logerr = await entryPoint.queryFilter(entryPoint.filters.UserOperationRevertReason())
    console.log(logerr)
    const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent())
    console.log('handleOps success=', log.args.success)
    console.log('aftermath called=', await sender.called())
  })

})
