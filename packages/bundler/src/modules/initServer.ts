import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

import { IEntryPoint__factory } from '@account-abstraction/utils'

import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import {
  ValidationManager,
  ValidationManagerRIP7560,
  IValidationManager
} from '@account-abstraction/validation-manager'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'
import { getNetworkProvider } from '../Config'
import { BundleManagerRIP7560 } from './BundleManagerRIP7560'
import { IBundleManager } from './IBundleManager'
import { DepositManager } from './DepositManager'

/**
 * initialize server modules.
 * returns the ExecutionManager and EventsManager (for handling events, to update reputation)
 * @param config
 * @param signer
 */
export function initServer (config: BundlerConfig, signer: Signer): [ExecutionManager, EventsManager, ReputationManager, MempoolManager] {
  const entryPoint = IEntryPoint__factory.connect(config.entryPoint, signer)
  const reputationManager = new ReputationManager(getNetworkProvider(config.network), BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
  const mempoolManager = new MempoolManager(reputationManager)
  const eventsManager = new EventsManager(entryPoint, mempoolManager, reputationManager)
  let validationManager: IValidationManager
  let bundleManager: IBundleManager
  if (!config.useRip7560Mode) {
    validationManager = new ValidationManager(entryPoint, config.unsafe)
    bundleManager = new BundleManager(entryPoint, entryPoint.provider as JsonRpcProvider, signer, eventsManager, mempoolManager, validationManager, reputationManager,
      config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc)
  } else {
    validationManager = new ValidationManagerRIP7560(entryPoint.provider as JsonRpcProvider, config.unsafe)
    bundleManager = new BundleManagerRIP7560(entryPoint.provider as JsonRpcProvider, signer, eventsManager, mempoolManager, validationManager, reputationManager,
      config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc, false)
  }
  const depositManager = new DepositManager(entryPoint, mempoolManager, bundleManager)
  const executionManager = new ExecutionManager(reputationManager, mempoolManager, bundleManager, validationManager, depositManager)

  reputationManager.addWhitelist(...config.whitelist ?? [])
  reputationManager.addBlacklist(...config.blacklist ?? [])
  executionManager.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)

  return [executionManager, eventsManager, reputationManager, mempoolManager]
}
