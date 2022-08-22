import ow from 'ow'
import fs from 'fs'

import { program } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common/dist/src'
import { ethers, Wallet } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { BundlerServer } from './BundlerServer'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { EntryPoint, EntryPoint__factory } from '@erc4337/common/dist/src/types'

import { BundlerHelper, BundlerHelper__factory } from './types'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

const CONFIG_FILE_NAME = 'workdir/bundler.config.json'

program
  .version(erc4337RuntimeVersion)
  .option('--beneficiary <string>', 'address to receive funds')
  .option('--gasFactor <number>')
  .option('--minBalance <number>', 'below this signer balance, keep fee for itself, ignoring "beneficiary" address ')
  .option('--network <string>', 'network name or url')
  .option('--mnemonic <string>', 'signer account secret key mnemonic')
  .option('--helper <string>', 'address of the BundlerHelper contract')
  .option('--entryPoint <string>', 'address of the supported EntryPoint contract')
  .option('--port <number>', 'server listening port (default to 3000)')
  .option('--config <string>', `path to config file (default to ${CONFIG_FILE_NAME})`, CONFIG_FILE_NAME)
  .parse()

console.log('command-line arguments: ', program.opts())

export function resolveConfiguration (): BundlerConfig {
  let fileConfig: Partial<BundlerConfig> = {}

  const commandLineParams = getCommandLineParams()
  const configFileName = program.opts().config
  if (fs.existsSync(configFileName)) {
    fileConfig = JSON.parse(fs.readFileSync(configFileName, 'ascii'))
  }
  const mergedConfig = Object.assign({}, bundlerConfigDefault, fileConfig, commandLineParams)
  console.log('Merged configuration:', JSON.stringify(mergedConfig))
  ow(mergedConfig, ow.object.exactShape(BundlerConfigShape))
  return mergedConfig
}

function getCommandLineParams (): Partial<BundlerConfig> {
  const params: any = {}
  for (const bundlerConfigShapeKey in BundlerConfigShape) {
    const optionValue = program.opts()[bundlerConfigShapeKey]
    if (optionValue != null) {
      params[bundlerConfigShapeKey] = optionValue
    }
  }
  return params as BundlerConfig
}

export async function connectContracts (
  wallet: Wallet,
  entryPointAddress: string,
  bundlerHelperAddress: string): Promise<{ entryPoint: EntryPoint, bundlerHelper: BundlerHelper }> {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, wallet)
  const bundlerHelper = BundlerHelper__factory.connect(bundlerHelperAddress, wallet)
  return {
    entryPoint,
    bundlerHelper
  }
}

async function main (): Promise<void> {
  const config = resolveConfiguration()
  const provider: BaseProvider = ethers.getDefaultProvider(config.network)
  const wallet: Wallet = Wallet.fromMnemonic(config.mnemonic).connect(provider)

  const { entryPoint, bundlerHelper } = await connectContracts(wallet, config.entryPoint, config.helper)

  const methodHandler = new UserOpMethodHandler(
    provider,
    wallet,
    config,
    entryPoint,
    bundlerHelper
  )

  const bundlerServer = new BundlerServer(
    methodHandler,
    config,
    provider,
    wallet
  )

  await bundlerServer.preflightCheck()

  console.log('connected to network', await provider.getNetwork().then(net => {
    return { name: net.name, chainId: net.chainId }
  }))
  console.log(`running on http://localhost:${config.port}`)
}

main()
  .catch(e => {
    console.log(e)
    process.exit(1)
  })
