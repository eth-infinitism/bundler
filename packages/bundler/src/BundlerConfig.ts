// TODO: consider adopting config-loading approach from hardhat to allow code in config file
import ow from 'ow'

// RIP-7560 EntyPoint address
const MIN_UNSTAKE_DELAY = 86400
const MIN_STAKE_VALUE = 1e18.toString()

export interface BundlerConfig {
  chainId: number
  beneficiary: string
  entryPoint: string
  senderCreator: string
  gasFactor: string
  minBalance: string
  mnemonic: string
  network: string
  port: string
  privateApiPort: string
  unsafe: boolean
  tracerRpcUrl?: string
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

  eip7702Support: boolean
  // Config overrides for PreVerificationGas calculation
  fixedGasOverhead?: number
  perUserOpGasOverhead?: number
  perUserOpWordGasOverhead?: number
  zeroByteGasCost?: number
  nonZeroByteGasCost?: number
  expectedBundleSize?: number
  estimationSignatureSize?: number
  estimationPaymasterDataSize?: number
}

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const BundlerConfigShape = {
  chainId: ow.number,
  beneficiary: ow.string,
  entryPoint: ow.string,
  senderCreator: ow.string,
  gasFactor: ow.string,
  minBalance: ow.string,
  mnemonic: ow.string,
  network: ow.string,
  port: ow.string,
  privateApiPort: ow.string,
  unsafe: ow.boolean,
  tracerRpcUrl: ow.optional.string,
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
  gethDevMode: ow.boolean,
  eip7702Support: ow.boolean,

  // Config overrides for PreVerificationGas calculation
  fixedGasOverhead: ow.optional.number,
  perUserOpGasOverhead: ow.optional.number,
  perUserOpWordGasOverhead: ow.optional.number,
  zeroByteGasCost: ow.optional.number,
  nonZeroByteGasCost: ow.optional.number,
  expectedBundleSize: ow.optional.number,
  estimationSignatureSize: ow.optional.number,
  estimationPaymasterDataSize: ow.optional.number
}

/**
 * Only parameters in this object can be provided by a 'debug_bundler_setConfiguration' API.
 */
export const DebugBundlerConfigShape = {
  fixedGasOverhead: ow.optional.number,
  perUserOpGasOverhead: ow.optional.number,
  perUserOpWordGasOverhead: ow.optional.number,
  zeroByteGasCost: ow.optional.number,
  nonZeroByteGasCost: ow.optional.number,
  expectedBundleSize: ow.optional.number,
  estimationSignatureSize: ow.optional.number,
  estimationPaymasterDataSize: ow.optional.number
}

// TODO: consider if we want any default fields at all
// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: '3000',
  privateApiPort: '3001',
  entryPoint: '0x4337084d9e255ff0702461cf8895ce9e3b5ff108',
  senderCreator: '0x449ED7C3e6Fee6a97311d4b55475DF59C44AdD33',
  unsafe: false,
  conditionalRpc: false,
  minStake: MIN_STAKE_VALUE,
  minUnstakeDelay: MIN_UNSTAKE_DELAY,
  eip7702Support: true
}
