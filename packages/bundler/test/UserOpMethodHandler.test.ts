import { BaseProvider } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { parseEther, resolveProperties } from 'ethers/lib/utils'

import { BundlerConfig } from '../src/BundlerConfig'
import {
  EntryPoint,
  EntryPoint__factory,
  SimpleAccountFactory__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import { Signer, Wallet } from 'ethers'
import { DeterministicDeployer, SimpleAccountAPI } from '@account-abstraction/sdk'
import { postExecutionDump } from '@account-abstraction/utils/dist/src/postExecCheck'
import {
  SampleRecipient,
  TestRulesAccount,
  TestRulesAccount__factory
} from '../src/types'
import { resolveHexlify } from '@account-abstraction/utils'
import { UserOperationEventEvent } from '@account-abstraction/contracts/dist/types/EntryPoint'
import { UserOperationReceipt } from '../src/RpcTypes'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { MempoolManager } from '../src/modules/MempoolManager'
import { ValidationManager } from '../src/modules/ValidationManager'
import { BundleManager } from '../src/modules/BundleManager'
import { isGeth, waitFor } from '../src/utils'
import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import { ethers } from 'hardhat'
import { createSigner } from './testUtils'
import { EventsManager } from '../src/modules/EventsManager'

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let accountDeployerAddress: string
  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: Signer
  const accountSigner = Wallet.createRandom()
  let mempoolMgr: MempoolManager

  let entryPoint: EntryPoint
  let sampleRecipient: SampleRecipient

  before(async function () {
    provider = ethers.provider

    signer = await createSigner()
    entryPoint = await new EntryPoint__factory(signer).deploy()

    DeterministicDeployer.init(ethers.provider)
    accountDeployerAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [entryPoint.address])

    const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    sampleRecipient = await sampleRecipientFactory.deploy()

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      gasFactor: '0.2',
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: '3000',
      unsafe: !await isGeth(provider as any),
      conditionalRpc: false,
      autoBundleInterval: 0,
      autoBundleMempoolSize: 0,
      maxBundleGas: 5e6,
      // minstake zero, since we don't fund deployer.
      minStake: '0',
      minUnstakeDelay: 0
    }

    const repMgr = new ReputationManager(BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
    mempoolMgr = new MempoolManager(repMgr)
    const validMgr = new ValidationManager(entryPoint, repMgr, config.unsafe)
    const evMgr = new EventsManager(entryPoint, mempoolMgr, repMgr)
    const bundleMgr = new BundleManager(entryPoint, evMgr, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, false)
    const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)
    methodHandler = new UserOpMethodHandler(
      execManager,
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
      expect(ret.verificationGas).to.be.closeTo(300000, 100000)
      // execution should be quite low.
      // (NOTE: actual execution should revert: it only succeeds because the wallet is NOT deployed yet,
      // and estimation doesn't perform full deploy-validate-execute cycle)
      expect(ret.callGasLimit).to.be.closeTo(25000, 10000)
    })
  })

  describe('sendUserOperation', function () {
    let userOperation: UserOperationStruct
    let accountAddress: string

    let accountDeployerAddress: string
    let userOpHash: string
    before(async function () {
      DeterministicDeployer.init(ethers.provider)
      accountDeployerAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [entryPoint.address])

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
      userOpHash = await methodHandler.sendUserOperation(await resolveHexlify(userOperation), entryPoint.address)
    })

    it('should send UserOperation transaction to entryPoint', async function () {
      // sendUserOperation is async, even in auto-mining. need to wait for it.
      const event = await waitFor(async () => await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(userOpHash)).then(ret => ret?.[0]))

      const transactionReceipt = await event!.getTransactionReceipt()
      assert.isNotNull(transactionReceipt)
      const logs = transactionReceipt.logs.filter(log => log.address === entryPoint.address)
        .map(log => entryPoint.interface.parseLog(log))
      expect(logs.map(log => log.name)).to.eql([
        'AccountDeployed',
        'Deposited',
        'BeforeExecution',
        'UserOperationEvent'
      ])
      const [senderEvent] = await sampleRecipient.queryFilter(sampleRecipient.filters.Sender(), transactionReceipt.blockHash)
      const userOperationEvent = logs[3]

      assert.equal(userOperationEvent.args.success, true)

      const expectedTxOrigin = await methodHandler.signer.getAddress()
      assert.equal(senderEvent.args.txOrigin, expectedTxOrigin, 'sample origin should be bundler')
      assert.equal(senderEvent.args.msgSender, accountAddress, 'sample msgsender should be account address')
    })

    it('getUserOperationByHash should return submitted UserOp', async () => {
      const ret = await methodHandler.getUserOperationByHash(userOpHash)
      expect(ret?.entryPoint === entryPoint.address)
      expect(ret?.userOperation.sender).to.eql(userOperation.sender)
      expect(ret?.userOperation.callData).to.eql(userOperation.callData)
    })

    it('getUserOperationReceipt should return receipt', async () => {
      const rcpt = await methodHandler.getUserOperationReceipt(userOpHash)
      expect(rcpt?.sender === userOperation.sender)
      expect(rcpt?.success).to.be.true
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
        expect(e.message).to.match(/AA21 didn't pay prefund/)
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
    // test events, good enough for _filterLogs
    function userOpEv (hash: any): any {
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
      const callData = acc.interface.encodeFunctionData('execSendMessage')

      const op: UserOperationStruct = {
        sender: acc.address,
        initCode: '0x',
        nonce: 0,
        callData,
        callGasLimit: 1e6,
        verificationGasLimit: 1e6,
        preVerificationGas: 50000,
        maxFeePerGas: 1e6,
        maxPriorityFeePerGas: 1e6,
        paymasterAndData: '0x',
        signature: Buffer.from('emit-msg')
      }
      await entryPoint.depositTo(acc.address, { value: parseEther('1') })
      // await signer.sendTransaction({to:acc.address, value: parseEther('1')})
      userOpHash = await entryPoint.getUserOpHash(op)
      const beneficiary = signer.getAddress()
      await entryPoint.handleOps([op], beneficiary).then(async ret => await ret.wait())
      const rcpt = await methodHandler.getUserOperationReceipt(userOpHash)
      if (rcpt == null) {
        throw new Error('getUserOperationReceipt returns null')
      }
      receipt = rcpt
    })

    it('should return null for nonexistent hash', async () => {
      expect(await methodHandler.getUserOperationReceipt(ethers.constants.HashZero)).to.equal(null)
    })

    it('receipt should contain only userOp execution events..', async () => {
      expect(receipt.logs.length).to.equal(1)
      acc.interface.decodeEventLog('TestMessage', receipt.logs[0].data, receipt.logs[0].topics)
    })
    it('general receipt fields', () => {
      expect(receipt.success).to.equal(true)
      expect(receipt.sender).to.equal(acc.address)
    })
    it('receipt should carry transaction receipt', () => {
      // filter out BOR-specific events..
      const logs = receipt.receipt.logs
        .filter(log => log.address !== '0x0000000000000000000000000000000000001010')
      const eventNames = logs
        // .filter(l => l.address == entryPoint.address)
        .map(l => {
          try {
            return entryPoint.interface.parseLog(l)
          } catch (e) {
            return acc.interface.parseLog(l)
          }
        })
        .map(l => l.name)
      expect(eventNames).to.eql([
        'TestFromValidation', // account validateUserOp
        'BeforeExecution', // entryPoint marker
        'TestMessage', // account execution event
        'UserOperationEvent' // post-execution event
      ])
    })
  })
})
