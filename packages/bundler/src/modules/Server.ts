import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from './ValidationManager'
import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { JsonRpcProvider, Provider } from '@ethersproject/providers'
import { parseEther } from 'ethers/lib/utils'
import { UserOperation } from './moduleUtils'
import { Signer } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'

class Server {
  private execMgr: ExecutionManager

  constructor (config: BundlerConfig, signer: Signer) {
    const entryPoint = EntryPoint__factory.connect(config.entryPoint, signer)
    const repMgr = new ReputationManager(BundlerReputationParams)
    const mempoolMgr = new MempoolManager(repMgr)
    const validMgr = new ValidationManager(entryPoint, repMgr, parseEther(config.minStake), config.minUnstakeDelay)
    const bundleMgr = new BundleManager(entryPoint, mempoolMgr, validMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
    this.execMgr = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)
  }

  async handleUserOp (userOp: UserOperation, entryPointInput: string) {
    await this.execMgr.sendUserOperation(userOp, entryPointInput)
  }
}
