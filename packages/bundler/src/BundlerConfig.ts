// TODO: consider adopting config-loading approach from hardhat to allow code in config file
import ow from 'ow'

export interface EipParameters {
  MIN_UNSTAKE_DELAY: string
  MIN_STAKE_VALUE: string
  SAME_SENDER_MEMPOOL_COUNT: string
  SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT: string
  THROTTLED_ENTITY_MEMPOOL_COUNT: string
  THROTTLED_ENTITY_LIVE_BLOCKS: string
  THROTTLED_ENTITY_BUNDLE_COUNT: string
  MIN_INCLUSION_RATE_DENOMINATOR: string
  INCLUSION_RATE_FACTOR: string
  THROTTLING_SLACK: string
  BAN_SLACK: string
}

export const EipParametersShape = {
  MIN_UNSTAKE_DELAY: ow.string,
  MIN_STAKE_VALUE: ow.string,
  SAME_SENDER_MEMPOOL_COUNT: ow.string,
  SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT: ow.string,
  THROTTLED_ENTITY_MEMPOOL_COUNT: ow.string,
  THROTTLED_ENTITY_LIVE_BLOCKS: ow.string,
  THROTTLED_ENTITY_BUNDLE_COUNT: ow.string,
  MIN_INCLUSION_RATE_DENOMINATOR: ow.string,
  INCLUSION_RATE_FACTOR: ow.string,
  THROTTLING_SLACK: ow.string,
  BAN_SLACK: ow.string
}

export const eipDefaultParams: EipParameters = {
  MIN_UNSTAKE_DELAY: '86400',
  MIN_STAKE_VALUE: 1e18.toString(),
  SAME_SENDER_MEMPOOL_COUNT: '4',
  SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT: '10',
  THROTTLED_ENTITY_MEMPOOL_COUNT: '4',
  THROTTLED_ENTITY_LIVE_BLOCKS: '10',
  THROTTLED_ENTITY_BUNDLE_COUNT: '4',
  MIN_INCLUSION_RATE_DENOMINATOR: '2',
  INCLUSION_RATE_FACTOR: '10',
  THROTTLING_SLACK: '5',
  BAN_SLACK: '10'

}
export interface BundlerConfig {
  beneficiary: string
  entryPoint: string
  gasFactor: string
  minBalance: string
  mnemonic: string
  network: string
  port: string
  unsafe: boolean
  debugRpc?: boolean
  conditionalRpc: boolean

  whitelist?: string[]
  blacklist?: string[]
  maxBundleGas: number
  eipParams: EipParameters
  autoBundleInterval: number
  autoBundleMempoolSize: number
}

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const BundlerConfigShape = {
  beneficiary: ow.string,
  entryPoint: ow.string,
  gasFactor: ow.string,
  minBalance: ow.string,
  mnemonic: ow.string,
  network: ow.string,
  port: ow.string,
  unsafe: ow.boolean,
  debugRpc: ow.optional.boolean,
  conditionalRpc: ow.boolean,

  whitelist: ow.optional.array.ofType(ow.string),
  blacklist: ow.optional.array.ofType(ow.string),
  maxBundleGas: ow.number,
  eipParams: ow.object.exactShape(EipParametersShape),
  autoBundleInterval: ow.number,
  autoBundleMempoolSize: ow.number
}

// TODO: consider if we want any default fields at all
// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: '3000',
  entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  unsafe: false,
  conditionalRpc: false,
  eipParams: eipDefaultParams
}
