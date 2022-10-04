import ow from 'ow'
import fs from 'fs'

import { Command } from 'commander'
import { erc4337RuntimeVersion } from '@account-abstraction/utils'
import { ethers, Wallet } from 'ethers'
import { BaseProvider } from '@ethersproject/providers'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { BundlerServer } from './BundlerServer'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'

import { BundlerHelper, BundlerHelper__factory } from './types'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

const CONFIG_FILE_NAME = 'workdir/bundler.config.json'

export let showStackTraces = false
export function resolveConfiguration (programOpts: any): BundlerConfig {
  let fileConfig: Partial<BundlerConfig> = {}

  const commandLineParams = getCommandLineParams(programOpts)
  const configFileName = programOpts.config
  if (fs.existsSync(configFileName)) {
    fileConfig = JSON.parse(fs.readFileSync(configFileName, 'ascii'))
  }
  const mergedConfig = Object.assign({}, bundlerConfigDefault, fileConfig, commandLineParams)
  console.log('Merged configuration:', JSON.stringify(mergedConfig))
  ow(mergedConfig, ow.object.exactShape(BundlerConfigShape))
  return mergedConfig
}

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

/**
 * start the bundler server.
 * this is an async method, but only to resolve configuration. after it returns, the server is only active after asyncInit()
 * @param argv
 * @param overrideExit
 */
export async function runBundler (argv: string[], overrideExit = true): Promise<BundlerServer> {
  const program = new Command()

  if (overrideExit) {
    (program as any)._exit = (exitCode: any, code: any, message: any) => {
      class CommandError extends Error {
        constructor (message: string, readonly code: any, readonly exitCode: any) {
          super(message)
        }
      }
      throw new CommandError(message, code, exitCode)
    }
  }

  program
    .version(erc4337RuntimeVersion)
    .option('--beneficiary <string>', 'address to receive funds')
    .option('--gasFactor <number>', '', '1')
    .option('--minBalance <number>', 'below this signer balance, keep fee for itself, ignoring "beneficiary" address ')
    .option('--network <string>', 'network name or url')
    .option('--mnemonic <file>', 'mnemonic/private-key file of signer account')
    .option('--helper <string>', 'address of the BundlerHelper contract')
    .option('--entryPoint <string>', 'address of the supported EntryPoint contract')
    .option('--port <number>', 'server listening port', '3000')
    .option('--config <string>', 'path to config file)', CONFIG_FILE_NAME)
    .option('--show-stack-traces', 'Show stack traces.')
    .option('--createMnemonic', 'create the mnemonic file')

  const programOpts = program.parse(argv).opts()
  showStackTraces = programOpts.showStackTraces

  console.log('command-line arguments: ', program.opts())

  const config = resolveConfiguration(programOpts)
  if (programOpts.createMnemonic != null) {
    const mnemonicFile = config.mnemonic
    console.log('Creating mnemonic in file', mnemonicFile)
    if (fs.existsSync(mnemonicFile)) {
      throw new Error(`Can't --createMnemonic: out file ${mnemonicFile} already exists`)
    }
    const newMnemonic = Wallet.createRandom().mnemonic.phrase
    fs.writeFileSync(mnemonicFile, newMnemonic)
    console.log('creaed mnemonic file', mnemonicFile)
    process.exit(1)
  }
  const provider: BaseProvider =
    // eslint-disable-next-line
    config.network === 'hardhat' ? require('hardhat').ethers.provider :
      ethers.getDefaultProvider(config.network)
  let mnemonic: string
  let wallet: Wallet
  try {
    mnemonic = fs.readFileSync(config.mnemonic, 'ascii').trim()
    wallet = Wallet.fromMnemonic(mnemonic).connect(provider)
  } catch (e: any) {
    throw new Error(`Unable to read --mnemonic ${config.mnemonic}: ${e.message as string}`)
  }

  const {
    entryPoint
    // bundlerHelper
  } = await connectContracts(wallet, config.entryPoint, config.helper)

  const methodHandler = new UserOpMethodHandler(
    provider,
    wallet,
    config,
    entryPoint
  )

  const bundlerServer = new BundlerServer(
    methodHandler,
    config,
    provider,
    wallet
  )

  void bundlerServer.asyncStart().then(async () => {
    console.log('connected to network', await provider.getNetwork().then(net => {
      return {
        name: net.name,
        chainId: net.chainId
      }
    }))
    console.log(`running on http://localhost:${config.port}/rpc`)
  })

  return bundlerServer
}
