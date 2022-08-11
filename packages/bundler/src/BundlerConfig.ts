// TODO: consider adopting config-loading approach from hardhat to allow code in config file

export interface BundlerConfig {
  mnemonic: string
  network: string
  beneficiary: string
  port: number
  helper: string
  entryPoint: string
  minBalance: string
  gasFactor: number
}

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const BundlerConfigShape = {

}

// TODO: implement merging config (args -> config.js -> default) and runtime shape validation
export const bundlerConfigDefault: Partial<BundlerConfig> = {
  port: 3000,
  helper: '0xdD747029A0940e46D20F17041e747a7b95A67242',
  entryPoint: '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69'
}