import { BaseProvider, JsonRpcSigner, Network, Provider } from '@ethersproject/providers'
import { ethers } from 'hardhat'
import { expectEvent } from '@openzeppelin/test-helpers'

import { ERC4337EthersProvider } from '@erc4337/client/dist/src/ERC4337EthersProvider'
import { ERC4337EthersSigner } from '@erc4337/client/dist/src/ERC4337EthersSigner'
import { UserOperation } from '@erc4337/common/dist/UserOperation'

import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import { BundlerHelper, EntryPoint } from '../src/types'
import { BundlerConfig } from '../src/BundlerConfig'
import { SmartWalletAPI } from '@erc4337/client/dist/src/SmartWalletAPI'
import { UserOpAPI } from '@erc4337/client/dist/src/UserOpAPI'

describe('UserOpMethodHandler', function () {
  let methodHandler: UserOpMethodHandler
  let provider: BaseProvider
  let signer: JsonRpcSigner

  let entryPoint: EntryPoint
  let bundleHelper: BundlerHelper
  let sampleRecipient: any

  before(async function () {
    provider = ethers.provider
    signer = ethers.provider.getSigner()

    // TODO: extract to Hardhat Fixture and reuse across test file
    const SingletonFactoryFactory = await ethers.getContractFactory('SingletonFactory')
    const singletonFactory = await SingletonFactoryFactory.deploy()

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    entryPoint = await EntryPointFactory.deploy(singletonFactory.address, 1, 1)

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    bundleHelper = await bundleHelperFactory.deploy()

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      gasFactor: 1,
      helper: bundleHelper.address,
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: 3000,
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
      const smartWalletAPI = new SmartWalletAPI()
      const userOpAPI = new UserOpAPI()
      const network = await provider.getNetwork()
      erc4337EthersProvider = new ERC4337EthersProvider(
        network,
        signer,
        provider,
        '',
        smartWalletAPI,
        userOpAPI
      )

      userOperation = await erc4337EthersProvider.createUserOp({
        data: '',
        target: '',
        value: ''
      })
    })

    it('should send UserOperation transaction to BundlerHelper', async function () {
      const requestId = await methodHandler.sendUserOperation(userOperation, entryPoint.address)
      const transactionReceipt = await erc4337EthersProvider.getTransactionReceipt(requestId)

      await expectEvent.inTransaction(transactionReceipt.transactionHash, sampleRecipient, 'HelloWorld', {
        txOrigin: '',
        msgSender: ''
      })
    })
  })

  describe('', function () {
    it('')
  })
})
