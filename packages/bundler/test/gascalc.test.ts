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
import { AddressZero, decodeErrorReason } from '@account-abstraction/utils'
import { expect } from 'chai'
import { isGeth } from '../src/utils'

const provider = ethers.provider
const ethersSigner = provider.getSigner()

const DefaultsForUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGasLimit: 0,
  verificationGasLimit: 100000, // default verification gas. will add create2 cost (3200+200*length) if initCode exists
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

    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
    await entryPoint.depositTo(sender.address, { value: parseEther('1') })

    expect(await isGeth(provider), await provider.send('web3_clientVersion', [])).to.be.true
  })

  function pad (len: number, val = 1) {
    return hexlify(Buffer.alloc(len, val))
  }

  async function buildUserOp (params: CalcParams): Promise<UserOperation> {
    let op: UserOperation = {
      ...DefaultsForUserOp,
      verificationGasLimit: 1e5,
      callGasLimit: 1e5

    }
    if (params.initLen != null) {
      const salt = 0
      op.initCode = hexConcat([factory.address, factory.interface.encodeFunctionData('deploy', [salt, pad(params.initLen)])])
      //its a test factory: it ignores the data when calculating account address.
      op.sender = await factory.callStatic.deploy(0, '')
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

  it('validate traceCall matches the gas usage of actual transaction', async () => {
    //(basically, verify it doesn't estimate, just run the tx)
    const op: UserOperation = {
      ...DefaultsForUserOp,
      sender: sender.address,
      verificationGasLimit: 1e5,
      maxFeePerGas: 1,
      callGasLimit: 1e6
    }
    // await entryPoint.callStatic.simulateHandleOp(op)

    const tx = await entryPoint.populateTransaction.handleOps([op], beneficiary)
    const {
      gas,
      failed,
      returnValue
    } = await debug_traceCall(provider, tx, { disableStack: true })

    if (failed) {
      console.log('exception=', decodeErrorReason(returnValue.replace(/^(0x)?/, '0x')))
    }
    console.log('ret=', {
      gas,
      failed,
      returnValue
    })
    // await entryPoint.simulateHandleOp(op)
    const rcpt = await entryPoint.handleOps([op], beneficiary).then(r => r.wait())
    console.log('gasused=', rcpt.gasUsed)
  })

  async function checkGas (params: CalcParams) {
    const op = await buildUserOp({ callDataLen: 1 })
    const tx = await entryPoint.populateTransaction.handleOps([op], beneficiary)
    //wrapped call is only to check there's an actual "side-effect" of the call.
    // const tx = await epWrapper.populateTransaction.callEp(entryPoint.address, op)
    const {
      gas,
      failed,
      returnValue
    } = await debug_traceCall(provider, tx, { disableStack: true })
    if (failed) {
      throw Error(`Failed ${returnValue}`)
    }

    const exec = false
    if (exec) {
      // check actual transaction
      await ethersSigner.sendTransaction(tx)
      const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent())
      console.log('handleOps success=', log.args.success)
      console.log('aftermath called=', await sender.called())

    }
    return gas

  }

  it('check callData gas', async () => {
    for (let i = 0; i < 1000; i += 50) {
      const gas = await checkGas({ initLen: i })
      console.log('calldata', i, gas)
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
    const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent())
    console.log('handleOps success=', log.args.success)
    console.log('aftermath called=', await sender.called())
  })

})
