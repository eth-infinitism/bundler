import { ethers } from 'hardhat'
import { MainnetConfig, PreVerificationGasCalculator, SimpleAccountAPI } from '@account-abstraction/sdk'
import { Signer, Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import { expect } from 'chai'
import { JsonRpcProvider } from '@ethersproject/providers'

import {
  DeterministicDeployer,
  IEntryPoint,
  SimpleAccountFactory__factory,
  deployEntryPoint,
  resolveHexlify
} from '@account-abstraction/utils'
import { ValidationManager, supportsDebugTraceCall } from '@account-abstraction/validation-manager'

import { DebugMethodHandler } from '../src/DebugMethodHandler'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { BundlerConfig } from '../src/BundlerConfig'
import { MempoolManager } from '../src/modules/MempoolManager'
import { BundleManager, SendBundleReturn } from '../src/modules/BundleManager'
import { MethodHandlerERC4337 } from '../src/MethodHandlerERC4337'

import { createSigner } from './testUtils'
import { EventsManager } from '../src/modules/EventsManager'
import { DepositManager } from '../src/modules/DepositManager'
import { ERC7562Parser } from '@account-abstraction/validation-manager/dist/src/ERC7562Parser'

const provider = ethers.provider

describe('#DebugMethodHandler', () => {
  let debugMethodHandler: DebugMethodHandler
  let entryPoint: IEntryPoint
  let methodHandler: MethodHandlerERC4337
  let smartAccountAPI: SimpleAccountAPI
  let signer: Signer
  const accountSigner = Wallet.createRandom()

  before(async () => {
    signer = await createSigner()

    entryPoint = await deployEntryPoint(provider)
    DeterministicDeployer.init(provider)

    const config: BundlerConfig = {
      chainId: 1337,
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      senderCreator: '0x449ED7C3e6Fee6a97311d4b55475DF59C44AdD33',
      gasFactor: '0.2',
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: '3000',
      privateApiPort: '3001',
      unsafe: !await supportsDebugTraceCall(provider as any, false),
      conditionalRpc: false,
      autoBundleInterval: 0,
      autoBundleMempoolSize: 0,
      maxBundleGas: 5e6,
      // minstake zero, since we don't fund deployer.
      minStake: '0',
      rip7560: false,
      rip7560Mode: 'PULL',
      gethDevMode: false,
      minUnstakeDelay: 0,
      eip7702Support: false
    }

    const repMgr = new ReputationManager(provider, BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
    const mempoolMgr = new MempoolManager(repMgr)
    const preVerificationGasCalculator = new PreVerificationGasCalculator(MainnetConfig)
    const erc7562Parser = new ERC7562Parser(entryPoint.address, config.senderCreator)
    const validMgr = new ValidationManager(entryPoint, config.unsafe, preVerificationGasCalculator, erc7562Parser)
    const eventsManager = new EventsManager(entryPoint, mempoolMgr, repMgr)
    const bundleMgr = new BundleManager(entryPoint, entryPoint.provider as JsonRpcProvider, entryPoint.signer, eventsManager, mempoolMgr, validMgr, repMgr,
      config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, false)
    const depositManager = new DepositManager(entryPoint, mempoolMgr, bundleMgr)
    const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr, depositManager, entryPoint.signer, false, undefined, false)
    methodHandler = new MethodHandlerERC4337(
      execManager,
      provider,
      signer,
      config,
      entryPoint,
      preVerificationGasCalculator
    )

    debugMethodHandler = new DebugMethodHandler(execManager, eventsManager, repMgr, mempoolMgr)

    DeterministicDeployer.init(ethers.provider)
    const accountDeployerAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [entryPoint.address])

    smartAccountAPI = new SimpleAccountAPI({
      provider,
      entryPointAddress: entryPoint.address,
      owner: accountSigner,
      factoryAddress: accountDeployerAddress
    })
    const accountAddress = await smartAccountAPI.getAccountAddress()
    await signer.sendTransaction({
      to: accountAddress,
      value: parseEther('1')
    })
  })

  it('should return sendBundleNow hashes', async () => {
    debugMethodHandler.setBundlingMode('manual')
    const addr = await smartAccountAPI.getAccountAddress()
    const op1 = await smartAccountAPI.createSignedUserOp({
      target: addr,
      data: '0x'
    })
    const userOpHash = await methodHandler.sendUserOperation(await resolveHexlify(op1), entryPoint.address)
    const {
      transactionHash,
      userOpHashes
    } = await debugMethodHandler.sendBundleNow() as SendBundleReturn
    expect(userOpHashes).eql([userOpHash])
    const txRcpt = await provider.getTransactionReceipt(transactionHash)
    expect(txRcpt.to).to.eq(entryPoint.address)
  })
})
