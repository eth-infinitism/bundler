import ow from 'ow'
import fs from 'fs'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { ethers, Wallet } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'

function getCommandLineParams (programOpts: any): Partial<BundlerConfig> {
  const params: any = {}
  for (const bundlerConfigShapeKey in BundlerConfigShape) {
    const optionValue = programOpts[bundlerConfigShapeKey]
    if (optionValue != null) {
      params[bundlerConfigShapeKey] = optionValue
    }
  }
  return params as BundlerConfig
}

function mergeConfigs (...sources: Array<Partial<BundlerConfig>>): BundlerConfig {
  const mergedConfig = Object.assign({}, ...sources)
  ow(mergedConfig, ow.object.exactShape(BundlerConfigShape))
  return mergedConfig
}

export async function resolveConfiguration (programOpts: any): Promise<{ config: BundlerConfig, provider: BaseProvider, wallet: Wallet }> {
  const commandLineParams = getCommandLineParams(programOpts)
  let fileConfig: Partial<BundlerConfig> = {}
  const configFileName = programOpts.config
  if (fs.existsSync(configFileName)) {
    fileConfig = JSON.parse(fs.readFileSync(configFileName, 'ascii'))
  }
  const config = mergeConfigs(bundlerConfigDefault, fileConfig, commandLineParams)
  console.log('Merged configuration:', JSON.stringify(config))

  const provider: BaseProvider = config.network === 'hardhat'
    // eslint-disable-next-line
    ? require('hardhat').ethers.provider
    : ethers.getDefaultProvider(config.network)

  let mnemonic: string
  let wallet: Wallet
  try {
    mnemonic = fs.readFileSync(config.mnemonic, 'ascii').trim()
    wallet = Wallet.fromMnemonic(mnemonic).connect(provider)
  } catch (e: any) {
    throw new Error(`Unable to read --mnemonic ${config.mnemonic}: ${e.message as string}`)
  }
  return { config, provider, wallet }
}
