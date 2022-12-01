import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from './ValidationManager'
import { EntryPoint__factory } from '@account-abstraction/contracts'
import { parseEther } from 'ethers/lib/utils'
import { getDefaultProvider, Signer, Wallet } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'
import Debug from 'debug'
import fs from 'fs'

const debug = Debug('aa.init')

/**
 * initialize server modules.
 * returns the ExecutionManager and EventsManager (for handling events, to update reputation)
 * @param config
 * @param signer
 */
export function initServer (config: BundlerConfig, signer: Signer): [ExecutionManager, EventsManager] {
  const entryPoint = EntryPoint__factory.connect(config.entryPoint, signer)
  const repMgr = new ReputationManager(BundlerReputationParams)
  const mempoolMgr = new MempoolManager(repMgr)
  const validMgr = new ValidationManager(entryPoint, repMgr, parseEther(config.minStake), config.minUnstakeDelay)
  const bundleMgr = new BundleManager(entryPoint, mempoolMgr, validMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
  const eventsMgr = new EventsManager(entryPoint, repMgr)
  const execMgr = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)

  execMgr.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)

  return [execMgr, eventsMgr]
}
