import {
  AddressZero,
  deepHexlify,
  deployEntryPoint, IEntryPoint,
  UserOperation
} from '@account-abstraction/utils'
import { BundlerServer } from '../src/BundlerServer'
import { expect } from 'chai'
import { createSigner } from './testUtils'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { parseEther } from 'ethers/lib/utils'
import { MempoolManager } from '../src/modules/MempoolManager'
import { supportsDebugTraceCall, ValidationManager } from '@account-abstraction/validation-manager'
import { EventsManager } from '../src/modules/EventsManager'
import { BundleManager } from '../src/modules/BundleManager'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import { ethers } from 'hardhat'
import { BundlerConfig } from '../src/BundlerConfig'

describe('BundleServer', function () {
  let entryPoint: IEntryPoint
  let server: BundlerServer
  before(async () => {
    const provider = ethers.provider
    const signer = await createSigner()
    entryPoint = await deployEntryPoint(provider)

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      gasFactor: '0.2',
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: '3000',
      unsafe: !await supportsDebugTraceCall(provider as any),
      conditionalRpc: false,
      autoBundleInterval: 0,
      autoBundleMempoolSize: 0,
      maxBundleGas: 5e6,
      // minstake zero, since we don't fund deployer.
      minStake: '0',
      minUnstakeDelay: 0
    }

    const repMgr = new ReputationManager(provider, BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
    const mempoolMgr = new MempoolManager(repMgr)
    const validMgr = new ValidationManager(entryPoint, config.unsafe)
    const evMgr = new EventsManager(entryPoint, mempoolMgr, repMgr)
    const bundleMgr = new BundleManager(entryPoint, evMgr, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, false)
    const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)
    const methodHandler = new UserOpMethodHandler(
      execManager,
      provider,
      signer,
      config,
      entryPoint
    )
    const None: any = {}
    server = new BundlerServer(methodHandler, None, None, None, None)
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
      preVerificationGas: 50000,
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
