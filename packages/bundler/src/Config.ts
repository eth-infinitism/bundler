import ow from 'ow'
import fs from 'fs'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { Wallet } from 'ethers'
import * as dotenv from 'dotenv'
import { BaseProvider, JsonRpcProvider } from '@ethersproject/providers'
dotenv.config()

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

const DEFAULT_INFURA_ID = 'd442d82a1ab34327a7126a578428dfc4'

export function getNetworkProvider (url: string): JsonRpcProvider {
  if (url.match(/^[\w-]+$/) != null) {
    const infuraId = process.env.INFURA_ID1 ?? DEFAULT_INFURA_ID
    url = `https://${url}.infura.io/v3/${infuraId}`
  }
  console.log('url=', url)
  return new JsonRpcProvider(url)
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
    : getNetworkProvider(config.network)

  let wallet: Wallet
  try {
    wallet = new Wallet(process.env.SIGNER_PRIVATE_KEY as string).connect(provider)
  } catch (e: any) {
    throw new Error(`Unable to read SIGNER_PRIVATE_KEY from env: ${e.message as string}`)
  }
  return { config, provider, wallet }
}
