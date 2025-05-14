import { JsonRpcProvider } from '@ethersproject/providers'
import { expect } from 'chai'
import { parseEther } from 'ethers/lib/utils'

import {
  AddressZero,
  IEntryPoint,
  UserOperation,
  deepHexlify,
  deployEntryPoint
} from '@account-abstraction/utils'
import { ERC7562Parser, supportsDebugTraceCall, ValidationManager } from '@account-abstraction/validation-manager'
import { PreVerificationGasCalculator, MainnetConfig } from '@account-abstraction/sdk'

import { BundlerServer } from '../src/BundlerServer'
import { createSigner } from './testUtils'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { MempoolManager } from '../src/modules/MempoolManager'
import { EventsManager } from '../src/modules/EventsManager'
import { BundleManager } from '../src/modules/BundleManager'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { MethodHandlerERC4337 } from '../src/MethodHandlerERC4337'
import { BundlerConfig } from '../src/BundlerConfig'
import { DepositManager } from '../src/modules/DepositManager'
import { ethers } from 'hardhat'

describe('BundleServer', function () {
  let entryPoint: IEntryPoint
  let server: BundlerServer
  before(async () => {
    const provider = ethers.provider
    const signer = await createSigner()
    try {
      entryPoint = await deployEntryPoint(provider)
    } catch (e) {
      throw new Error(`Failed to deploy entry point - no RPC node?\n ${e as string}`)
    }

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
    const evMgr = new EventsManager(entryPoint, mempoolMgr, repMgr)
    const bundleMgr = new BundleManager(entryPoint, entryPoint.provider as JsonRpcProvider, entryPoint.signer, evMgr, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, false)
    const depositManager = new DepositManager(entryPoint, mempoolMgr, bundleMgr)
    const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr, depositManager, entryPoint.signer, false, undefined, false)
    const methodHandler = new MethodHandlerERC4337(
      execManager,
      provider,
      signer,
      config,
      entryPoint,
      preVerificationGasCalculator
    )
    const None: any = {}
    server = new BundlerServer(methodHandler, None, None, None, None, None)
    server.silent = true
  })

  it('should revert on invalid userop', async () => {
    const op = {}
    expect(await server.handleRpc({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_sendUserOperation',
      params: [op, entryPoint.address]
    })).to.eql({
      id: 1,
      jsonrpc: '2.0',

      error: {
        code: -32602,
        data: undefined,
        message: 'Missing userOp field: sender'
      }
    })
  })
  it('should return bundler error', async () => {
    const op: UserOperation = deepHexlify({
      sender: AddressZero,
      nonce: '0x1',
      callData: '0x',
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 60000,
      maxFeePerGas: 1e6,
      maxPriorityFeePerGas: 1e6,
      signature: '0x'
    })
    expect(await server.handleRpc({
      id: 1,
      jsonrpc: '2.0',
      method: 'eth_sendUserOperation',
      params: [op, entryPoint.address]
    })).to.eql({
      id: 1,
      jsonrpc: '2.0',
      error: {
        code: -32500,
        data: undefined,
        message: 'FailedOp(0,"AA20 account not deployed")'
      }
    })
  })
})
