import ow from 'ow'
import fs from 'fs'

import { program } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common/dist/src'
import { ethers, Wallet } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { BundlerServer } from './BundlerServer'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { EntryPoint, BundlerHelper, BundlerHelper__factory, EntryPoint__factory } from '@erc4337/common/dist/src/types'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

program
  .version(erc4337RuntimeVersion)
  .option('--beneficiary', 'address to receive funds')
  .option('--gasFactor')
  .option('--minBalance', 'below this signer balance, keep fee for itself, ignoring "beneficiary" address ')
  .option('--network', 'network name or url')
  .option('--mnemonic', 'signer account secret key mnemonic')
  .option('--helper', 'address of the BundlerHelper contract')
  .option('--port', 'server listening port (default to 3000)')
  .parse()

console.log('command-line arguments: ', program.opts())

const CONFIG_FILE_NAME = 'bundler.config.json'

export function resolveConfiguration (): BundlerConfig {
  const fileConfig: Partial<BundlerConfig> = JSON.parse(fs.readFileSync(CONFIG_FILE_NAME, 'ascii'))
  const mergedConfig = Object.assign({}, bundlerConfigDefault, fileConfig)
  ow(mergedConfig, ow.object.exactShape(BundlerConfigShape))
  return fileConfig as BundlerConfig
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
  .catch(e => console.log(e))
