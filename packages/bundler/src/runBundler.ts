import ow from 'ow'
import fs from 'fs'

import { Command } from 'commander'
import { erc4337RuntimeVersion } from '@account-abstraction/utils'
import { BigNumber, ethers, Wallet } from 'ethers'
import { BaseProvider, JsonRpcProvider } from '@ethersproject/providers'

import { BundlerConfig, bundlerConfigDefault, BundlerConfigShape } from './BundlerConfig'
import { BundlerServer } from './BundlerServer'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'

import { initServer } from './modules/initServer'
import { DebugMethodHandler } from './DebugMethodHandler'
import { DeterministicDeployer } from '@account-abstraction/sdk'
import { isGeth } from './utils'
import { parseEther } from 'ethers/lib/utils'

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
  entryPointAddress: string): Promise<{ entryPoint: EntryPoint }> {
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, wallet)
  return {
    entryPoint
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

  process.once('SIGINT', ()=>{
    console.log('SIGINT: exit')
    process.exit(1)
  })
  process.once('SIGTERM', ()=>{
    console.log('SIGTERM: exit')
    process.exit(1)
  })

  program
    .version(erc4337RuntimeVersion)
    .option('--beneficiary <string>', 'address to receive funds')
    .option('--gasFactor <number>', '', '1')
    .option('--minBalance <number>', 'below this signer balance, keep fee for itself, ignoring "beneficiary" address ')
    .option('--network <string>', 'network name or url')
    .option('--mnemonic <file>', 'mnemonic/private-key file of signer account')
    .option('--entryPoint <string>', 'address of the supported EntryPoint contract')
    .option('--port <number>', 'server listening port', '3000')
    .option('--config <string>', 'path to config file)', CONFIG_FILE_NAME)
    .option('--unsafe', 'UNSAFE mode: no storage or opcode checks (safe mode requires geth)')
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
    console.log('created mnemonic file', mnemonicFile)
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
    // name: chainName,
    chainId
  } = await provider.getNetwork()

  if (chainId === 31337 || chainId === 1337) {
    const deployer = new DeterministicDeployer(provider as any)
    const entryPointAddr = await deployer.getDeterministicDeployAddress(EntryPoint__factory.bytecode)
    if (!await deployer.isContractDeployed(entryPointAddr)) {
      console.log('=== Testnet: deploy EntryPoint at', entryPointAddr)
      await deployer.deterministicDeploy(EntryPoint__factory.bytecode)
    }

    if (BigNumber.from(0).eq(await wallet.getBalance())) {
      console.log('=== Testnet: fund signer account', wallet.address)
      const signer = (provider as JsonRpcProvider).getSigner()
      await signer.sendTransaction({
        to: wallet.address,
        value: parseEther('10')
      })
    }
  }

  if (!config.unsafe && !await isGeth(provider as any)) {
    console.error('FATAL: full validation requires GETH. for local UNSAFE mode: use --unsafe')
    process.exit(1)
  }

  const {
    entryPoint
  } = await connectContracts(wallet, config.entryPoint)

  // bundleSize=1 replicate current immediate bundling mode
  const execManagerConfig = {
    ...config,
    autoBundleMempoolSize: 1
  }

  const [execManager, eventsManager, reputationManager, mempoolManager] = initServer(execManagerConfig, entryPoint.signer)
  const methodHandler = new UserOpMethodHandler(
    execManager,
    provider,
    wallet,
    config,
    entryPoint
  )
  eventsManager.initEventListener()
  const debugHandler = new DebugMethodHandler(execManager, reputationManager, mempoolManager)

  const bundlerServer = new BundlerServer(
    methodHandler,
    debugHandler,
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
