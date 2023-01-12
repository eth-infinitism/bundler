import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from './ValidationManager'
import { EntryPoint__factory } from '@account-abstraction/contracts'
import { parseEther } from 'ethers/lib/utils'
import { Signer } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'
import { BundlerHelper__factory } from '../types'

/**
 * initialize server modules.
 * returns the ExecutionManager and EventsManager (for handling events, to update reputation)
 * @param config
 * @param signer
 */
export function initServer (config: BundlerConfig, signer: Signer): [ExecutionManager, EventsManager, ReputationManager, MempoolManager] {
  const entryPoint = EntryPoint__factory.connect(config.entryPoint, signer)
  const bundlerHelper = BundlerHelper__factory.connect(config.bundlerHelper, signer)
  const reputationManager = new ReputationManager(BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
  const mempoolManager = new MempoolManager(reputationManager)
  const validationManager = new ValidationManager(entryPoint, bundlerHelper, reputationManager, config.unsafe)
  const bundleManager = new BundleManager(entryPoint, mempoolManager, validationManager, reputationManager, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
  const eventsManager = new EventsManager(entryPoint, reputationManager)
  const executionManager = new ExecutionManager(reputationManager, mempoolManager, bundleManager, validationManager)

  reputationManager.addWhitelist(...config.whitelist ?? [])
  reputationManager.addBlacklist(...config.blacklist ?? [])
  executionManager.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)

  return [executionManager, eventsManager, reputationManager, mempoolManager]
}
