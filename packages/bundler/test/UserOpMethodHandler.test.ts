import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { assert } from 'chai'
import { ethers } from 'hardhat'

import { ERC4337EthersProvider } from '@erc4337/client/dist/src/ERC4337EthersProvider'
import { ERC4337EthersSigner } from '@erc4337/client/dist/src/ERC4337EthersSigner'
import { SimpleWalletAPI } from '@erc4337/client/dist/src/SimpleWalletAPI'
import { UserOpAPI } from '@erc4337/client/dist/src/UserOpAPI'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'

import { BundlerConfig } from '../src/BundlerConfig'
import { BundlerHelper, SampleRecipient } from '../src/types'
import { ClientConfig } from '@erc4337/client/dist/src/ClientConfig'
import { EntryPoint, SimpleWallet, SimpleWalletDeployer, SimpleWalletDeployer__factory, UserOperationStruct } from '@account-abstraction/contracts'

import { TransactionDetailsForUserOp } from '@erc4337/client/dist/src/TransactionDetailsForUserOp'
import 'source-map-support/register'

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner

  let entryPoint: EntryPoint
  let bundleHelper: BundlerHelper
  let simpleWallet: SimpleWallet
  let sampleRecipient: SampleRecipient

  let ownerAddress: string

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    ownerAddress = await signer.getAddress()

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

  describe('preflightCheck', function () {
    it('eth_chainId')
  })

  describe('eth_supportedEntryPoints', function () {
    it('')
  })

  describe('sendUserOperation', function () {
    let erc4337EthersProvider: ERC4337EthersProvider
    let erc4337EtherSigner: ERC4337EthersSigner

    let userOperation: UserOperationStruct
    let walletFactory: SimpleWalletDeployer

    before(async function () {
      walletFactory = await new SimpleWalletDeployer__factory(signer).deploy()
      const smartWalletAPI = new SimpleWalletAPI(
        entryPoint,
        undefined,
        ownerAddress,
        walletFactory.address,
        0
      )
      console.log('addr=', await smartWalletAPI.getSender())
      await signer.sendTransaction({
        to: smartWalletAPI.getSender(),
        value: 10e18.toString()
      })

      const info: TransactionDetailsForUserOp = {
        target: entryPoint.address,
        data: '0x',
        value: '0',
        gasLimit: '0'
      }
      const userOp = await smartWalletAPI.createUnsignedUserOp(info)
      console.log('creaetUserOp=', userOp)
      const userOpAPI = new UserOpAPI()
      const network = await provider.getNetwork()
      const clientConfig: ClientConfig = {
        entryPointAddress: entryPoint.address,
        bundlerUrl: '',
        chainId: network.chainId
      }

      erc4337EthersProvider = new ERC4337EthersProvider(
        clientConfig,
        signer,
        provider,
        // not called here - transaction is created and quitely passed to the Handler
        // @ts-ignore
        null,
        entryPoint,
        smartWalletAPI,
        userOpAPI
      )
      await erc4337EthersProvider.init()
      erc4337EtherSigner = erc4337EthersProvider.getSigner()

      userOperation = await erc4337EthersProvider.createUserOp({
        data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        target: sampleRecipient.address,
        value: '0',
        gasLimit: ''
      })

      userOperation.signature = await erc4337EtherSigner.signUserOperation(userOperation)
    })

    it('should send UserOperation transaction to BundlerHelper', async function () {
      const requestId = await methodHandler.sendUserOperation(userOperation, entryPoint.address)
      const transactionReceipt = await erc4337EthersProvider.getTransactionReceipt(requestId)

      assert.isNotNull(transactionReceipt)
      const depositedEvent = entryPoint.interface.parseLog(transactionReceipt.logs[0])
      const senderEvent = sampleRecipient.interface.parseLog(transactionReceipt.logs[1])
      const userOperationEvent = entryPoint.interface.parseLog(transactionReceipt.logs[2])
      assert.equal(userOperationEvent.name, 'UserOperationEvent')
      assert.equal(userOperationEvent.args.success, true)

      assert.equal(senderEvent.name, 'Sender')
      const expectedTxOrigin = await methodHandler.signer.getAddress()
      assert.equal(senderEvent.args.txOrigin, expectedTxOrigin)
      assert.equal(senderEvent.args.msgSender, simpleWallet.address)

      assert.equal(depositedEvent.name, 'Deposited')
    })
  })

  describe('', function () {
    it('')
  })
})
