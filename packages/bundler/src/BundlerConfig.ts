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

export const BundlerConfigShape
