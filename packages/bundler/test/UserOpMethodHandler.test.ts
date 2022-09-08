import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { parseEther } from 'ethers/lib/utils'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'

import { BundlerConfig } from '../src/BundlerConfig'
import { BundlerHelper, SampleRecipient } from '../src/types'
import {
  EntryPoint,
  SimpleWalletDeployer__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import 'source-map-support/register'
import { SimpleWalletAPI } from '@account-abstraction/sdk'
import { DeterministicDeployer } from '@account-abstraction/sdk/src/DeterministicDeployer'

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner

  let entryPoint: EntryPoint
  let bundleHelper: BundlerHelper
  let sampleRecipient: SampleRecipient

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    entryPoint = await EntryPointFactory.deploy(1, 1)

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    bundleHelper = await bundleHelperFactory.deploy()

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
      entryPoint,
      bundleHelper
    )
  })

  describe('eth_supportedEntryPoints', function () {
    it('eth_supportedEntryPoints', async () => {
      await expect(await methodHandler.getSupportedEntryPoints()).to.eql([entryPoint.address])
    })
  })

  describe('sendUserOperation', function () {
    let userOperation: UserOperationStruct
    let walletAddress: string

    before(async function () {
      const walletDeployerAddress = await DeterministicDeployer.deploy(SimpleWalletDeployer__factory.bytecode)

      const smartWalletAPI = new SimpleWalletAPI(
        provider,
        entryPoint.address,
        undefined,
        signer,
        walletDeployerAddress,
        0
      )
      walletAddress = await smartWalletAPI.getWalletAddress()
      await signer.sendTransaction({
        to: walletAddress,
        value: parseEther('1')
      })

      userOperation = await smartWalletAPI.createSignedUserOp({
        data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        target: sampleRecipient.address
      })
    })

    it('should send UserOperation transaction to BundlerHelper', async function () {
      const requestId = await methodHandler.sendUserOperation(userOperation, entryPoint.address)
      const req = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(requestId))
      const transactionReceipt = await req[0].getTransactionReceipt()

      assert.isNotNull(transactionReceipt)
      const depositedEvent = entryPoint.interface.parseLog(transactionReceipt.logs[0])
      const senderEvent = sampleRecipient.interface.parseLog(transactionReceipt.logs[1])
      const userOperationEvent = entryPoint.interface.parseLog(transactionReceipt.logs[2])
      assert.equal(userOperationEvent.name, 'UserOperationEvent')
      assert.equal(userOperationEvent.args.success, true)

      assert.equal(senderEvent.name, 'Sender')
      const expectedTxOrigin = await methodHandler.signer.getAddress()
      assert.equal(senderEvent.args.txOrigin, expectedTxOrigin)
      assert.equal(senderEvent.args.msgSender, walletAddress)

      assert.equal(depositedEvent.name, 'Deposited')
    })
  })
})
