import { BaseProvider, JsonRpcSigner } from '@ethersproject/providers'
import { ethers } from 'hardhat'
import { expectEvent } from '@openzeppelin/test-helpers'

import { ERC4337EthersProvider } from '@erc4337/client/dist/src/ERC4337EthersProvider'
import { ERC4337EthersSigner } from '@erc4337/client/dist/src/ERC4337EthersSigner'
import { SmartWalletAPI } from '@erc4337/client/dist/src/SmartWalletAPI'
import { UserOpAPI } from '@erc4337/client/dist/src/UserOpAPI'
import { UserOperation } from '@erc4337/common/src/UserOperation'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import {
  SimpleWallet,
  BundlerHelper,
  EntryPoint,
  SampleRecipient,
  SingletonFactory,
  SimpleWallet__factory
} from '../src/types'
import { BundlerConfig } from '../src/BundlerConfig'
import { ClientConfig } from '@erc4337/client/dist/src/ClientConfig'

describe('UserOpMethodHandler', function () {
  const helloWorld = 'hello world'

  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner

  let entryPoint: EntryPoint
  let bundleHelper: BundlerHelper
  let simpleWallet: SimpleWallet
  let singletonFactory: SingletonFactory
  let sampleRecipient: SampleRecipient

  let ownerAddress: string

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    ownerAddress = await signer.getAddress()

    // TODO: extract to Hardhat Fixture and reuse across test file
    const SingletonFactoryFactory = await ethers.getContractFactory('SingletonFactory')
    singletonFactory = await SingletonFactoryFactory.deploy()

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    entryPoint = await EntryPointFactory.deploy(singletonFactory.address, 1, 1)

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    bundleHelper = await bundleHelperFactory.deploy()

    const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    sampleRecipient = await sampleRecipientFactory.deploy()

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      gasFactor: 1,
      helper: bundleHelper.address,
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: 3000
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

    let userOperation: UserOperation

    before(async function () {
      // TODO: SmartWalletAPI should not accept wallet - this is chicken-and-egg; rework once creation flow is final
      const initCode = new SimpleWallet__factory().getDeployTransaction(entryPoint.address, ownerAddress).data
      await singletonFactory.deploy(initCode!, ethers.constants.HashZero)
      const simpleWalletAddress = await entryPoint.getSenderAddress(initCode!, 0)
      simpleWallet = SimpleWallet__factory.connect(simpleWalletAddress, signer)

      const smartWalletAPI = new SmartWalletAPI(
        provider,
        entryPoint,
        simpleWallet,
        ownerAddress,
        0
      )
      await smartWalletAPI.init()
      const userOpAPI = new UserOpAPI()
      const network = await provider.getNetwork()
      const clientConfig: ClientConfig = {
        entryPointAddress: entryPoint.address,
        chainId: network.chainId
      }

      erc4337EthersProvider = new ERC4337EthersProvider(
        network,
        clientConfig,
        signer,
        provider,
        '',
        smartWalletAPI,
        userOpAPI
      )
      erc4337EtherSigner = erc4337EthersProvider.getSigner()

      userOperation = await erc4337EthersProvider.createUserOp({
        data: sampleRecipient.interface.encodeFunctionData('something', [helloWorld]),
        target: sampleRecipient.address,
        value: '0'
      })

      userOperation.signature = await erc4337EtherSigner.signUserOperation(userOperation)
    })

    it('should send UserOperation transaction to BundlerHelper', async function () {
      const requestId = await methodHandler.sendUserOperation(userOperation, entryPoint.address)
      const transactionReceipt = await erc4337EthersProvider.getTransactionReceipt(requestId)

      await expectEvent.inTransaction(transactionReceipt.transactionHash, sampleRecipient, 'Sender', {
        txOrigin: sampleRecipient.address,
        msgSender: sampleRecipient.address,
        message: helloWorld
      })
    })
  })

  describe('', function () {
    it('')
  })
})
