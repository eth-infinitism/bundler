// TODO: consider adopting config-loading approach from hardhat to allow code in config file
import ow from 'ow'

export interface BundlerConfig {
  beneficiary: string
  entryPoint: string
  gasFactor: string
  helper: string
  minBalance: string
  mnemonic: string
  network: string
  port: string
}

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const BundlerConfigShape = {
  beneficiary: ow.string,
  entryPoint: ow.string,
  gasFactor: ow.string,
  helper: ow.string,
  minBalance: ow.string,
  mnemonic: ow.string,
  network: ow.string,
  port: ow.string
}

// TODO: consider if we want any default fields at all
// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: '3000',
  helper: '0xdD747029A0940e46D20F17041e747a7b95A67242',
  entryPoint: '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69'
}
