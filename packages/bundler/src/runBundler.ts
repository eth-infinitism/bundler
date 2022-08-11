import { program } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common'
import { ethers, Wallet } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'
import fs from 'fs'

import { BundlerConfig } from './BundlerConfig'
import { BundlerServer } from './BundlerServer'
import { UserOpMethodHandler } from './UserOpMethodHandler'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

program
  .version(erc4337RuntimeVersion)
  .option('--beneficiary')
  .option('--gasFactor')
  .option('--minBalance')
  .option('--network')
  .option('--mnemonic')
  .option('--helper')
  .option('--port')
  .parse()
console.log(program.opts())

function failWithUsage (missing: string[]): void {
  console.log(`Missing parameters: [${JSON.stringify(missing)}]`)
  console.log(`
create 'bundler.config.json' file or pass the command-line arguments
usage: yarn run bundler  [options]
  --port - server listening port (default to 3000)
  --beneficiary address to receive funds (defaults to signer)
  --minBalance - below this signer balance, use itself, not --beneficiary  
  --gasFactor - require that much on top of estimated gas (default=1)
  --network - network name/url
  --mnemonic - file
  --helper - BundlerHelper contract. deploy with "hardhat deploy"
  `)
}

const CONFIG_FILE_NAME = 'bundler.config.json'

function resolveConfiguration(): BundlerConfig {
  const fileConfig: Partial<BundlerConfig> = JSON.parse(fs.readFileSync(CONFIG_FILE_NAME, 'ascii'))
  // TODO: merge
  // TODO 2: using 'shape' find out what keys are missing and call 'failWithUsage'
  return fileConfig as BundlerConfig
}

async function main (): Promise<void> {
  const config = resolveConfiguration()
  const provider: BaseProvider = ethers.getDefaultProvider(config.network)
  const wallet: Wallet = Wallet.fromMnemonic(config.mnemonic).connect(provider)
  const methodHandler = new UserOpMethodHandler()

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
