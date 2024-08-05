// TODO: consider adopting config-loading approach from hardhat to allow code in config file
import ow from 'ow'

// RIP-7560 EntyPoint address
const MIN_UNSTAKE_DELAY = 86400
const MIN_STAKE_VALUE = 1e18.toString()
export interface BundlerConfig {
  beneficiary: string
  entryPoint: string
  gasFactor: string
  minBalance: string
  mnemonic: string
  network: string
  port: string
  privateApiPort: string
  unsafe: boolean
  debugRpc?: boolean
  conditionalRpc: boolean

  whitelist?: string[]
  blacklist?: string[]
  maxBundleGas: number
  minStake: string
  minUnstakeDelay: number
  autoBundleInterval: number
  autoBundleMempoolSize: number
  rip7560: boolean
  rip7560Mode: string
  gethDevMode: boolean
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
  privateApiPort: ow.string,
  unsafe: ow.boolean,
  debugRpc: ow.optional.boolean,
  conditionalRpc: ow.boolean,

  whitelist: ow.optional.array.ofType(ow.string),
  blacklist: ow.optional.array.ofType(ow.string),
  maxBundleGas: ow.number,
  minStake: ow.string,
  minUnstakeDelay: ow.number,
  autoBundleInterval: ow.number,
  autoBundleMempoolSize: ow.number,
  rip7560: ow.boolean,
  rip7560Mode: ow.string.oneOf(['PULL', 'PUSH']),
  gethDevMode: ow.boolean
}

// TODO: consider if we want any default fields at all
// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: '3000',
  privateApiPort: '3001',
  entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  unsafe: false,
  conditionalRpc: false,
  minStake: MIN_STAKE_VALUE,
  minUnstakeDelay: MIN_UNSTAKE_DELAY
}
