import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from '@account-abstraction/validation-manager'
import { EntryPoint__factory } from '@account-abstraction/contracts'
import { parseEther } from 'ethers/lib/utils'
import { Signer } from 'ethers'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'
import { getNetworkProvider } from '../Config'

/**
 * initialize server modules.
 * returns the ExecutionManager and EventsManager (for handling events, to update reputation)
 * @param config
 * @param signer
 */
export function initServer (config: BundlerConfig, signer: Signer): [ExecutionManager, EventsManager, ReputationManager, MempoolManager] {
  const entryPoint = EntryPoint__factory.connect(config.entryPoint, signer)
  const reputationManager = new ReputationManager(getNetworkProvider(config.network), BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
  const mempoolManager = new MempoolManager(reputationManager)
  const validationManager = new ValidationManager(entryPoint, config.unsafe)
  const eventsManager = new EventsManager(entryPoint, mempoolManager, reputationManager)
  const bundleManager = new BundleManager(entryPoint, eventsManager, mempoolManager, validationManager, reputationManager,
    config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc)
  const executionManager = new ExecutionManager(reputationManager, mempoolManager, bundleManager, validationManager)

  reputationManager.addWhitelist(...config.whitelist ?? [])
  reputationManager.addBlacklist(...config.blacklist ?? [])
  executionManager.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)

  return [executionManager, eventsManager, reputationManager, mempoolManager]
}
