import fs from 'fs'

import { Command } from 'commander'
import {
  deployEntryPoint,
  erc4337RuntimeVersion,
  IEntryPoint,
  RpcError,
  supportsRpcMethod
} from '@account-abstraction/utils'
import { ethers, Wallet, Signer } from 'ethers'

import { BundlerServer } from './BundlerServer'
import { MethodHandlerERC4337 } from './MethodHandlerERC4337'

import { initServer } from './modules/initServer'
import { DebugMethodHandler } from './DebugMethodHandler'
import {
  AA_NONCE_MANAGER,
  AA_STAKE_MANAGER,
  supportsDebugTraceCall,
  supportsNativeTracer
} from '@account-abstraction/validation-manager'
import { resolveConfiguration } from './Config'
import { bundlerConfigDefault } from './BundlerConfig'
import { parseEther } from 'ethers/lib/utils'
import { MethodHandlerRIP7560 } from './MethodHandlerRIP7560'
import { JsonRpcProvider } from '@ethersproject/providers'
import { deployNonceManager } from '@account-abstraction/utils/dist/src/RIP7712NonceManagerUtils'
import { deployStakeManager } from '@account-abstraction/utils/dist/src/deployStakeManager'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

const CONFIG_FILE_NAME = 'workdir/bundler.config.json'

export let showStackTraces = false

export async function connectContracts (
  wallet: Signer,
  deployNewEntryPoint: boolean = true): Promise<{ entryPoint?: IEntryPoint }> {
  if (!deployNewEntryPoint) {
    return { entryPoint: undefined }
  }
  const entryPoint = await deployEntryPoint(wallet.provider as any, wallet as any)
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

  program
    .version(erc4337RuntimeVersion)
    .option('--beneficiary <string>', 'address to receive funds')
    .option('--gasFactor <number>')
    .option('--minBalance <number>', 'below this signer balance, keep fee for itself, ignoring "beneficiary" address ')
    .option('--network <string>', 'network name or url')
    .option('--mnemonic <file>', 'mnemonic/private-key file of signer account')
    .option('--entryPoint <string>', 'address of the supported EntryPoint contract')
    .option('--port <number>', `server listening port for public clients (default: ${bundlerConfigDefault.port})`)
    .option('--privateApiPort <number>', `server listening port for block builder (default: ${bundlerConfigDefault.privateApiPort})`)
    .option('--config <string>', 'path to config file', CONFIG_FILE_NAME)
    .option('--auto', 'automatic bundling (bypass config.autoBundleMempoolSize)', false)
    .option('--unsafe', 'UNSAFE mode: no storage or opcode checks (safe mode requires debug_traceCall)')
    .option('--tracerRpcUrl <string>', 'run native tracer on this provider, and prestateTracer native tracer on network provider. requires unsafe=false')
    .option('--debugRpc', 'enable debug rpc methods (auto-enabled for test node')
    .option('--conditionalRpc', 'Use eth_sendRawTransactionConditional RPC)')
    .option('--show-stack-traces', 'Show stack traces.')
    .option('--createMnemonic <file>', 'create the mnemonic file')
    .option('--rip7560', 'Use this bundler as an RIP-7560 node')
    .option('--rip7560Mode <string>', 'PUSH mode sends bundles to node at an interval, PULL mode waits for node to query bundle')
    .option('--gethDevMode', 'In PULL mode send 1 wei transaction to trigger block creation')

  const programOpts = program.parse(argv).opts()
  showStackTraces = programOpts.showStackTraces

  console.log('command-line arguments: ', program.opts())

  if (programOpts.createMnemonic != null) {
    const mnemonicFile: string = programOpts.createMnemonic
    console.log('Creating mnemonic in file', mnemonicFile)
    if (fs.existsSync(mnemonicFile)) {
      throw new Error(`Can't --createMnemonic: out file ${mnemonicFile} already exists`)
    }
    const newMnemonic = Wallet.createRandom().mnemonic.phrase
    fs.writeFileSync(mnemonicFile, newMnemonic)
    console.log('created mnemonic file', mnemonicFile)
    process.exit(1)
  }
  const { config, provider, wallet } = await resolveConfiguration(programOpts)

  const {
    // name: chainName,
    chainId
  } = await provider.getNetwork()

  if (chainId === 31337 || chainId === 1337) {
    if (config.debugRpc == null) {
      console.log('== debugrpc was', config.debugRpc)
      config.debugRpc = true
    } else {
      console.log('== debugrpc already st', config.debugRpc)
    }
    if ((await wallet.getBalance()).eq(0)) {
      console.log('=== testnet: fund signer')
      const signer = provider.getSigner()
      await signer.sendTransaction({ to: await wallet.getAddress(), value: parseEther('1') })
    }
  }

  if (config.conditionalRpc && !await supportsRpcMethod(provider as any, 'eth_sendRawTransactionConditional', [{}, {}])) {
    console.error('FATAL: --conditionalRpc requires a node that support eth_sendRawTransactionConditional')
    process.exit(1)
  }
  if (config.unsafe) {
    if (config.tracerRpcUrl != null) {
      console.error('FATAL: --unsafe and --tracerRpcUrl are mutually exclusive')
      process.exit(1)
    }
  } else {
    if (config.tracerRpcUrl != null) {
      // validate standard tracer supports "prestateTracer":
      if (!await supportsNativeTracer(provider, 'prestateTracer')) {
        console.error('FATAL: --tracerRpcUrl requires the network provider to support prestateTracer')
        process.exit(1)
      }
    } else {
      // check standard javascript tracer:
      if (!await supportsDebugTraceCall(provider as any, config.rip7560)) {
        const requiredApi = config.rip7560 ? 'eth_traceRip7560Validation' : 'debug_traceCall'
        console.error(`FATAL: full validation requires a node with ${requiredApi}. for local UNSAFE mode: use --unsafe`)
        process.exit(1)
      }
    }
  }

  if (config.rip7560) {
    try {
      const nonceManager = await deployNonceManager(provider, wallet as any)
      if (nonceManager.address.toLowerCase() !== AA_NONCE_MANAGER.toLowerCase()) {
        throw new Error(`NonceManager deployed at ${nonceManager.address} does not match constant AA_NONCE_MANAGER=${AA_NONCE_MANAGER}`)
      }
      const stakeManager = await deployStakeManager(provider, wallet as any)
      if (stakeManager.address.toLowerCase() !== AA_STAKE_MANAGER.toLowerCase()) {
        throw new Error(`StakeManager deployed at ${stakeManager.address} does not match constant AA_STAKE_MANAGER=${AA_STAKE_MANAGER}`)
      }
    } catch (e: any) {
      console.warn(e)
      if (!(e.message as string).includes('replacement fee too low') && !(e.message as string).includes('already known')) throw e
    }
  }

  const {
    entryPoint
  } = await connectContracts(wallet, !config.rip7560)

  if (entryPoint != null && entryPoint?.address?.toLowerCase() !== config.entryPoint.toLowerCase() && [1337, 31337].includes(chainId)) {
    console.warn('NOTICE: overriding config entrypoint: ', { entryPoint: entryPoint.address })
    config.entryPoint = entryPoint.address
    config.senderCreator = await entryPoint.senderCreator()
  }

  // bundleSize=1 replicate current immediate bundling mode
  const execManagerConfig = {
    ...config
    // autoBundleMempoolSize: 0
  }
  if (programOpts.auto === true) {
    execManagerConfig.autoBundleMempoolSize = 0
    execManagerConfig.autoBundleInterval = 0
  }

  const [
    execManager,
    eventsManager,
    reputationManager,
    mempoolManager,
    preVerificationGasCalculator
  ] = initServer(execManagerConfig, wallet)
  const methodHandler = new MethodHandlerERC4337(
    execManager,
    provider,
    wallet,
    config,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    entryPoint!,
    preVerificationGasCalculator
  )
  const methodHandlerRip7560 = new MethodHandlerRIP7560(
    execManager,
    wallet.provider as JsonRpcProvider
  )

  eventsManager.initEventListener()
  const debugHandler = config.debugRpc ?? false
    ? new DebugMethodHandler(execManager, eventsManager, reputationManager, mempoolManager)
    : new Proxy({}, {
      get (target: {}, method: string, receiver: any): any {
        throw new RpcError(`method debug_bundler_${method} is not supported`, -32601)
      }
    }) as DebugMethodHandler

  const bundlerServer = new BundlerServer(
    methodHandler,
    methodHandlerRip7560,
    debugHandler,
    config,
    provider,
    wallet
  )

  void bundlerServer.asyncStart().then(async () => {
    console.log('Bundle interval (seconds)', execManagerConfig.autoBundleInterval)
    console.log('connected to network', await provider.getNetwork().then(net => {
      return {
        name: net.name,
        chainId: net.chainId
      }
    }))
    console.log(`public client API running on http://localhost:${config.port}/rpc`)
    console.log(`block builder API running on http://localhost:${config.privateApiPort}/rpc`)
  })

  return bundlerServer
}
