import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { parseEther, resolveProperties } from 'ethers/lib/utils'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'

import { BundlerConfig } from '../src/BundlerConfig'
import {
  EntryPoint,
  SimpleAccountDeployer__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import { Wallet } from 'ethers'
import { DeterministicDeployer, SimpleAccountAPI } from '@account-abstraction/sdk'
import { postExecutionDump } from '@account-abstraction/utils/dist/src/postExecCheck'
import { BundlerHelper, SampleRecipient } from '../src/types'
import { deepHexlify } from '@account-abstraction/utils'

//resolve all property and hexlify.
// (UserOpMethodHandler receives data from the network, so we need to pack our generated values)
async function resolveHexlify(a:any): Promise<any> {
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
    let target:string
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
      const ret =await methodHandler.estimateUserOperationGas(await resolveHexlify(op), entryPoint.address)
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
      const ret =await methodHandler.callUserOperation(await resolveHexlify(op), entryPoint.address)
      // (NOTE: actual execution should revert: it only succeeds because the wallet is NOT deployed yet,
      // and view-call doesn't perform full deploy-validate-execute cycle)
      console.log('ret=', ret)
      expect(ret.success).to.equal(true)
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
})
