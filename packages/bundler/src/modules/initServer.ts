import { ExecutionManager } from './ExecutionManager'
import { ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import { ValidationManager } from './ValidationManager'
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
  const reputationManager = new ReputationManager(
    getNetworkProvider(config.network),
    {
      banSlack: parseInt(config.eipParams.BAN_SLACK),
      throttlingSlack: parseInt(config.eipParams.THROTTLING_SLACK),
      minInclusionDenominator: parseInt(config.eipParams.MIN_INCLUSION_RATE_DENOMINATOR)
    },
    parseEther(config.eipParams.MIN_STAKE_VALUE),
    parseInt(config.eipParams.MIN_UNSTAKE_DELAY)
  )
  const mempoolManager = new MempoolManager(reputationManager)
  const validationManager = new ValidationManager(entryPoint, reputationManager, config.unsafe)
  const eventsManager = new EventsManager(entryPoint, mempoolManager, reputationManager)
  const bundleManager = new BundleManager(entryPoint, eventsManager, mempoolManager, validationManager, reputationManager,
    config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc)
  const executionManager = new ExecutionManager(reputationManager, mempoolManager, bundleManager, validationManager)

  reputationManager.addWhitelist(...config.whitelist ?? [])
  reputationManager.addBlacklist(...config.blacklist ?? [])
  executionManager.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)

  return [executionManager, eventsManager, reputationManager, mempoolManager]
}
