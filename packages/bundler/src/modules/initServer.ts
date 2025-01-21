import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

import { IEntryPoint__factory } from '@account-abstraction/utils'

import { ExecutionManager } from './ExecutionManager'
import { BundlerReputationParams, ReputationManager } from './ReputationManager'
import { MempoolManager } from './MempoolManager'
import { BundleManager } from './BundleManager'
import {
  AA_ENTRY_POINT,
  AA_NONCE_MANAGER,
  AA_SENDER_CREATOR,
  AA_STAKE_MANAGER,
  IValidationManager,
  ValidationManager,
  ValidationManagerRIP7560
} from '@account-abstraction/validation-manager'
import { BundlerConfig } from '../BundlerConfig'
import { EventsManager } from './EventsManager'
import { getNetworkProvider } from '../Config'
import { BundleManagerRIP7560 } from './BundleManagerRIP7560'
import { IBundleManager } from './IBundleManager'
import { DepositManager } from './DepositManager'
import { IRip7560StakeManager__factory } from '@account-abstraction/utils/dist/src/types'
import { PreVerificationGasCalculator, ChainConfigs } from '@account-abstraction/sdk'
import { ERC7562Parser } from '@account-abstraction/validation-manager/dist/src/ERC7562Parser'

/**
 * initialize server modules.
 * returns the ExecutionManager and EventsManager (for handling events, to update reputation)
 * @param config
 * @param signer
 */
export function initServer (config: BundlerConfig, signer: Signer): [ExecutionManager, EventsManager, ReputationManager, MempoolManager, PreVerificationGasCalculator] {
  const entryPoint = IEntryPoint__factory.connect(config.entryPoint, signer)
  const reputationManager = new ReputationManager(getNetworkProvider(config.network), BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
  const mempoolManager = new MempoolManager(reputationManager)
  const eventsManager = new EventsManager(entryPoint, mempoolManager, reputationManager)
  const mergedPvgcConfig = Object.assign({}, ChainConfigs[config.chainId] ?? {}, config)
  const preVerificationGasCalculator = new PreVerificationGasCalculator(mergedPvgcConfig)
  let validationManager: IValidationManager
  let bundleManager: IBundleManager
  if (!config.rip7560) {
    const erc7562Parser = new ERC7562Parser(entryPoint.address, config.senderCreator)
    const tracerProvider = config.tracerRpcUrl == null ? undefined : getNetworkProvider(config.tracerRpcUrl)
    validationManager = new ValidationManager(entryPoint, config.unsafe, preVerificationGasCalculator, erc7562Parser, tracerProvider)
    bundleManager = new BundleManager(entryPoint, entryPoint.provider as JsonRpcProvider, signer, eventsManager, mempoolManager, validationManager, reputationManager,
      config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc)
  } else {
    const erc7562Parser = new ERC7562Parser(AA_ENTRY_POINT, AA_SENDER_CREATOR, AA_NONCE_MANAGER)
    const stakeManager = IRip7560StakeManager__factory.connect(AA_STAKE_MANAGER, signer)
    validationManager = new ValidationManagerRIP7560(stakeManager, entryPoint.provider as JsonRpcProvider, erc7562Parser, config.unsafe)
    bundleManager = new BundleManagerRIP7560(entryPoint.provider as JsonRpcProvider, signer, eventsManager, mempoolManager, validationManager, reputationManager,
      config.beneficiary, parseEther(config.minBalance), config.maxBundleGas, config.conditionalRpc, false)
  }
  const depositManager = new DepositManager(entryPoint, mempoolManager, bundleManager)
  const executionManager = new ExecutionManager(reputationManager, mempoolManager, bundleManager, validationManager, depositManager, signer, config.rip7560, config.rip7560Mode, config.gethDevMode)

  reputationManager.addWhitelist(...config.whitelist ?? [])
  reputationManager.addBlacklist(...config.blacklist ?? [])
  if (config.rip7560 && config.rip7560Mode === 'PUSH') {
    executionManager.setAutoBundler(config.autoBundleInterval, config.autoBundleMempoolSize)
  }
  return [executionManager, eventsManager, reputationManager, mempoolManager, preVerificationGasCalculator]
}
