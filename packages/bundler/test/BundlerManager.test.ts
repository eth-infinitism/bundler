import { JsonRpcProvider } from '@ethersproject/providers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'
import { parseEther } from 'ethers/lib/utils'

import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import {
  AddressZero,
  getUserOpHash,
  packUserOp,
  UserOperation,
  deployEntryPoint, IEntryPoint, DeterministicDeployer
} from '@account-abstraction/utils'
import { PreVerificationGasCalculator, MainnetConfig } from '@account-abstraction/sdk'

import { ValidationManager, supportsDebugTraceCall } from '@account-abstraction/validation-manager'
import { MempoolManager } from '../src/modules/MempoolManager'
import { BundleManager } from '../src/modules/BundleManager'
import { BundlerConfig } from '../src/BundlerConfig'
import { TestFakeWalletToken__factory } from '../src/types'
import { MethodHandlerERC4337 } from '../src/MethodHandlerERC4337'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { EventsManager } from '../src/modules/EventsManager'
import { createSigner } from './testUtils'
import { DepositManager } from '../src/modules/DepositManager'
import { ERC7562Parser } from '@account-abstraction/validation-manager/dist/src/ERC7562Parser'

describe('#BundlerManager', () => {
  let bm: BundleManager

  let entryPoint: IEntryPoint

  const provider = ethers.provider
  const signer = provider.getSigner()

  before(async function () {
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
      autoBundleInterval: 0,
      autoBundleMempoolSize: 0,
      maxBundleGas: 5e6,
      // minstake zero, since we don't fund deployer.
      minStake: '0',
      minUnstakeDelay: 0,
      rip7560: false,
      rip7560Mode: 'PULL',
      gethDevMode: false,
      conditionalRpc: false,
      eip7702Support: false
    }

    const repMgr = new ReputationManager(provider, BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
    const mempoolMgr = new MempoolManager(repMgr)
    const preVerificationGasCalculator = new PreVerificationGasCalculator(MainnetConfig)
    const erc7562Parser = new ERC7562Parser(entryPoint.address, config.senderCreator)
    const validMgr = new ValidationManager(entryPoint, config.unsafe, preVerificationGasCalculator, erc7562Parser)
    const evMgr = new EventsManager(entryPoint, mempoolMgr, repMgr)
    bm = new BundleManager(entryPoint, entryPoint.provider as JsonRpcProvider, entryPoint.signer, evMgr, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc)
  })

  it('#getUserOpHashes', async () => {
    const userOp: UserOperation = {
      sender: AddressZero,
      nonce: 1,
      signature: '0x03',
      callData: '0x05',
      callGasLimit: 6,
      verificationGasLimit: 7,
      maxFeePerGas: 8,
      maxPriorityFeePerGas: 9,
      preVerificationGas: 10
    }

    const hash = await entryPoint.getUserOpHash(packUserOp(userOp))
    const bmHash = await bm.getUserOpHashes([userOp])
    expect(bmHash).to.eql([hash])
  })

  describe('createBundle', function () {
    let methodHandler: MethodHandlerERC4337
    let bundleMgr: BundleManager

    before(async function () {
      const bundlerSigner = await createSigner()
      const _entryPoint = entryPoint.connect(bundlerSigner)
      const config: BundlerConfig = {
        chainId: 1337,
        beneficiary: await bundlerSigner.getAddress(),
        entryPoint: _entryPoint.address,
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
      const validMgr = new ValidationManager(_entryPoint, config.unsafe, preVerificationGasCalculator, erc7562Parser)
      const evMgr = new EventsManager(_entryPoint, mempoolMgr, repMgr)
      bundleMgr = new BundleManager(_entryPoint, _entryPoint.provider as JsonRpcProvider, _entryPoint.signer, evMgr, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, false)
      const depositManager = new DepositManager(entryPoint, mempoolMgr, bundleMgr)
      const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr, depositManager, _entryPoint.signer, false, undefined, false)
      execManager.setAutoBundler(0, 1000)

      methodHandler = new MethodHandlerERC4337(
        execManager,
        provider,
        bundlerSigner,
        config,
        _entryPoint,
        preVerificationGasCalculator
      )
    })

    it('should not include a UserOp that accesses the storage of a different known sender', async function () {
      if (!await supportsDebugTraceCall(ethers.provider, false)) {
        console.log('WARNING: opcode banning tests can only run with geth')
        this.skip()
      }

      const wallet1 = await new TestFakeWalletToken__factory(signer).deploy(entryPoint.address)
      const wallet2 = await new TestFakeWalletToken__factory(signer).deploy(entryPoint.address)

      await wallet1.sudoSetBalance(wallet1.address, parseEther('1'))
      await wallet1.sudoSetBalance(wallet2.address, parseEther('1'))
      await wallet2.sudoSetAnotherWallet(wallet1.address)
      const calldata1 = wallet2.address
      const calldata2 = '0x'

      const cEmptyUserOp: UserOperation = {
        sender: AddressZero,
        nonce: '0x0',
        signature: '0x',
        callData: '0x',
        callGasLimit: '0x0',
        verificationGasLimit: '0x50000',
        maxFeePerGas: '0x0',
        maxPriorityFeePerGas: '0x0',
        preVerificationGas: '0x50000'
      }
      const userOp1: UserOperation = {
        ...cEmptyUserOp,
        sender: wallet1.address,
        callData: calldata1
      }
      const userOp2: UserOperation = {
        ...cEmptyUserOp,
        sender: wallet2.address,
        callData: calldata2
      }
      await methodHandler.sendUserOperation(userOp1, entryPoint.address)
      await methodHandler.sendUserOperation(userOp2, entryPoint.address)

      const bundle = await bundleMgr.sendNextBundle()
      await bundleMgr.handlePastEvents()
      const mempool = bundleMgr.mempoolManager.getSortedForInclusion()

      assert.equal(bundle!.userOpHashes.length, 1)
      assert.equal(bundle!.userOpHashes[0], getUserOpHash(userOp1, entryPoint.address, await signer.getChainId()))
      assert.equal(mempool.length, 1)
      assert.equal(mempool[0].userOp.sender, wallet2.address)
    })
  })
})
