import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { parseEther, resolveProperties } from 'ethers/lib/utils'

import { UserOperationReceipt, UserOpMethodHandler } from '../src/UserOpMethodHandler'

import { BundlerConfig } from '../src/BundlerConfig'
import { EntryPoint, SimpleAccountDeployer__factory, UserOperationStruct } from '@account-abstraction/contracts'

import { Wallet } from 'ethers'
import { DeterministicDeployer, SimpleAccountAPI } from '@account-abstraction/sdk'
import { postExecutionDump } from '@account-abstraction/utils/dist/src/postExecCheck'
import {
  BundlerHelper, SampleRecipient, TestRulesAccount__factory, TestRulesAccount
} from '../src/types'
import { deepHexlify, packUserOp } from '@account-abstraction/utils'
import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'

//resolve all property and hexlify.
// (UserOpMethodHandler receives data from the network, so we need to pack our generated values)
async function resolveHexlify (a: any): Promise<any> {
  return deepHexlify(await resolveProperties(a))
}

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let accountDeployerAddress: string

  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner
  const accountSigner = Wallet.createRandom()

  let entryPoint: EntryPoint
  let bundleHelper: BundlerHelper
  let sampleRecipient: SampleRecipient

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    DeterministicDeployer.init(ethers.provider)
    accountDeployerAddress = await DeterministicDeployer.deploy(SimpleAccountDeployer__factory.bytecode)

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    entryPoint = await EntryPointFactory.deploy()

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    bundleHelper = await bundleHelperFactory.deploy()
    console.log('bundler from=', await bundleHelper.signer.getAddress())
    const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    sampleRecipient = await sampleRecipientFactory.deploy()

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      gasFactor: '0.2',
      helper: bundleHelper.address,
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: '3000'
    }

    methodHandler = new UserOpMethodHandler(
      provider,
      signer,
      config,
      entryPoint
    )
  })

  describe('eth_supportedEntryPoints', function () {
    it('eth_supportedEntryPoints', async () => {
      await expect(await methodHandler.getSupportedEntryPoints()).to.eql([entryPoint.address])
    })
  })

  describe('query rpc calls: eth_estimateUserOperationGas, eth_callUserOperation', function () {
    let owner: Wallet
    let smartAccountAPI: SimpleAccountAPI
    let target: string
    before('init', async () => {
      owner = Wallet.createRandom()
      target = await Wallet.createRandom().getAddress()
      smartAccountAPI = new SimpleAccountAPI({
        provider,
        entryPointAddress: entryPoint.address,
        owner,
        factoryAddress: accountDeployerAddress
      })
    })
    it('estimateUserOperationGas should estimate even without eth', async () => {
      const op = await smartAccountAPI.createSignedUserOp({
        target,
        data: '0xdeadface'
      })
      const ret = await methodHandler.estimateUserOperationGas(await resolveHexlify(op), entryPoint.address)
      // verification gas should be high - it creates this wallet
      expect(ret.verificationGas).to.be.closeTo(1e6, 300000)
      // execution should be quite low.
      // (NOTE: actual execution should revert: it only succeeds because the wallet is NOT deployed yet,
      // and estimation doesn't perform full deploy-validate-execute cycle)
      expect(ret.callGasLimit).to.be.closeTo(25000, 10000)
    })
    it('callUserOperation should work without eth', async () => {
      const op = await resolveProperties(await smartAccountAPI.createSignedUserOp({
        target,
        data: '0xdeadface'
      }))
      const ret = await methodHandler.callUserOperation(await resolveHexlify(op), entryPoint.address)
      // (NOTE: actual execution should revert: it only succeeds because the wallet is NOT deployed yet,
      // and view-call doesn't perform full deploy-validate-execute cycle)
      expect(ret.success).to.equal(true, ret as any)
    })
  })

  describe('sendUserOperation', function () {
    let userOperation: UserOperationStruct
    let accountAddress: string

    let accountDeployerAddress: string
    before(async function () {
      DeterministicDeployer.init(ethers.provider)
      accountDeployerAddress = await DeterministicDeployer.deploy(SimpleAccountDeployer__factory.bytecode)

      const smartAccountAPI = new SimpleAccountAPI({
        provider,
        entryPointAddress: entryPoint.address,
        owner: accountSigner,
        factoryAddress: accountDeployerAddress
      })
      accountAddress = await smartAccountAPI.getAccountAddress()
      await signer.sendTransaction({
        to: accountAddress,
        value: parseEther('1')
      })

      userOperation = await resolveProperties(await smartAccountAPI.createSignedUserOp({
        data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        target: sampleRecipient.address
      }))
    })

    it('should send UserOperation transaction to BundlerHelper', async function () {
      const userOpHash = await methodHandler.sendUserOperation(await resolveHexlify(userOperation), entryPoint.address)
      const req = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(userOpHash))
      const transactionReceipt = await req[0].getTransactionReceipt()

      assert.isNotNull(transactionReceipt)
      const depositedEvent = entryPoint.interface.parseLog(transactionReceipt.logs[0])
      const senderEvent = sampleRecipient.interface.parseLog(transactionReceipt.logs[1])
      const userOperationEvent = entryPoint.interface.parseLog(transactionReceipt.logs[2])
      assert.equal(userOperationEvent.name, 'UserOperationEvent')
      assert.equal(userOperationEvent.args.success, true)

      assert.equal(senderEvent.name, 'Sender')
      const expectedTxOrigin = await methodHandler.signer.getAddress()
      assert.equal(senderEvent.args.txOrigin, expectedTxOrigin, 'sample origin should be bundler')
      assert.equal(senderEvent.args.msgSender, accountAddress, 'sample msgsender should be account address')

      assert.equal(depositedEvent.name, 'Deposited')
    })

    it('should expose FailedOp errors as text messages', async () => {
      const smartAccountAPI = new SimpleAccountAPI({
        provider,
        entryPointAddress: entryPoint.address,
        owner: accountSigner,
        factoryAddress: accountDeployerAddress,
        index: 1
      })
      const op = await smartAccountAPI.createSignedUserOp({
        data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        target: sampleRecipient.address
      })

      try {
        await methodHandler.sendUserOperation(await resolveHexlify(op), entryPoint.address)
        throw Error('expected fail')
      } catch (e: any) {
        expect(e.message).to.match(/account didn't pay prefund/)
      }
    })

    describe('validate get paid enough', function () {
      it('should pay just enough', async () => {
        const api = new SimpleAccountAPI({
          provider,
          entryPointAddress: entryPoint.address,
          accountAddress,
          owner: accountSigner
        })
        const op = await api.createSignedUserOp({
          data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
          target: sampleRecipient.address,
          gasLimit: 1e6
        })
        const id = await methodHandler.sendUserOperation(await resolveHexlify(op), entryPoint.address)

        // {
        //   console.log('wrong method')
        //   await methodHandler.sendUserOperation(await api.createSignedUserOp({
        //     data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld + helloWorld + helloWorld + helloWorld + helloWorld]).padEnd(2000, '1'),
        //     target: accountAddress,
        //     gasLimit: 1e6
        //
        //   }), entryPoint.address)
        // }
        //
        // {
        //   console.log('self nonce')
        //   const data = keccak256(Buffer.from('nonce()')).slice(0, 10)
        //   await methodHandler.sendUserOperation(await api.createSignedUserOp({
        //     data: data,
        //     target: accountAddress,
        //     gasLimit: 1e6
        //
        //   }), entryPoint.address)
        // }

        await postExecutionDump(entryPoint, id)
      })
      it('should reject if doesn\'t pay enough', async () => {
        const api = new SimpleAccountAPI({
          provider,
          entryPointAddress: entryPoint.address,
          accountAddress,
          owner: accountSigner,
          overheads: { perUserOp: 0 }
        })
        const op = await api.createSignedUserOp({
          data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
          target: sampleRecipient.address
        })
        try {
          await methodHandler.sendUserOperation(await resolveHexlify(op), entryPoint.address)
          throw new Error('expected to revert')
        } catch (e: any) {
          expect(e.message).to.match(/preVerificationGas too low/)
        }
      })
    })
  })

  describe('#_filterLogs', function () {
    //test events, good enough for _filterLogs
    function userOpEv (hash: any) {
      return {
        topics: ['userOpTopic', hash]
      } as any
    }

    function ev (topic: any): UserOperationEventEvent {
      return {
        topics: [topic]
      } as any
    }

    const ev1 = ev(1)
    const ev2 = ev(2)
    const ev3 = ev(3)
    const u1 = userOpEv(10)
    const u2 = userOpEv(20)
    const u3 = userOpEv(30)
    it('should fail if no UserOperationEvent', async () => {
      expect(() => methodHandler._filterLogs(u1, [ev1])).to.throw('no UserOperationEvent in logs')
    })
    it('should return empty array for single-op bundle with no events', async () => {
      expect(methodHandler._filterLogs(u1, [u1])).to.eql([])
    })
    it('should return events for single-op bundle', async () => {
      expect(methodHandler._filterLogs(u1, [ev1, ev2, u1])).to.eql([ev1, ev2])
    })
    it('should return events for middle userOp in a bundle', async () => {
      expect(methodHandler._filterLogs(u1, [ev2, u2, ev1, u1, ev3, u3])).to.eql([ev1])
    })
  })

  describe('#getUserOperationReceipt', function () {
    let userOpHash: string
    let receipt: UserOperationReceipt
    let acc: TestRulesAccount
    before(async () => {
      acc = await new TestRulesAccount__factory(signer).deploy()
      const op: UserOperationStruct = {
        sender: acc.address,
        initCode: '0x',
        nonce: 0,
        callData: '0x',
        callGasLimit: 1e6,
        verificationGasLimit: 1e6,
        preVerificationGas: 50000,
        maxFeePerGas: 1e6,
        maxPriorityFeePerGas: 1e6,
        paymasterAndData: '0x',
        signature: Buffer.from('emit-msg')
      }
      await entryPoint.depositTo(acc.address, {value: parseEther('1')})
      // await signer.sendTransaction({to:acc.address, value: parseEther('1')})
      console.log(2)
      userOpHash = await entryPoint.getUserOpHash(op)
      const beneficiary = signer.getAddress()
      await entryPoint.handleOps([op], beneficiary).then(ret => ret.wait())
      const rcpt = await methodHandler.getUserOperationReceipt(userOpHash)
      if (rcpt == null) {
        throw new Error('getUserOperationReceipt returns null')
      }
      receipt = rcpt
    })

    it('should return null for nonexistent hash', async () => {
      expect(await methodHandler.getUserOperationReceipt(ethers.constants.HashZero)).to.equal(null)
    })

    it('receipt should contain only userOp-specific events..', async () => {
      expect(receipt.logs.length).to.equal(1)
      const evParams = acc.interface.decodeEventLog('TestMessage', receipt.logs[0].data, receipt.logs[0].topics)
      expect(evParams.eventSender).to.equal(acc.address)
    })
    it('general receipt fields', ()=>{
      expect(receipt.success).to.equal(true)
      expect(receipt.sender).to.equal(acc.address)
    })
    it('receipt should carry transaction receipt', ()=> {
      //one UserOperationEvent, and one op-specific event.
      expect(receipt.receipt.logs.length).to.equal(2)
    })
  })
})
