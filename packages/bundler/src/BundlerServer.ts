import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, Response, Request, RequestHandler } from 'express'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer, utils } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import { Server } from 'http'

import {
  AddressZero,
  IEntryPoint__factory,
  RpcError,
  UserOperation,
  ValidationErrors,
  decodeRevertReason,
  deepHexlify,
  erc4337RuntimeVersion,
  packUserOp
} from '@account-abstraction/utils'

import { BundlerConfig } from './BundlerConfig'
import { MethodHandlerERC4337 } from './MethodHandlerERC4337'
import { MethodHandlerRIP7560 } from './MethodHandlerRIP7560'
import { DebugMethodHandler } from './DebugMethodHandler'

import Debug from 'debug'

const debug = Debug('aa.rpc')

export class BundlerServer {
  readonly appPublic: Express
  readonly appPrivate: Express
  private readonly httpServerPublic: Server
  private readonly httpServerPrivate: Server
  public silent = false

  constructor (
    readonly methodHandler: MethodHandlerERC4337,
    readonly methodHandlerRip7560: MethodHandlerRIP7560,
    readonly debugHandler: DebugMethodHandler,
    readonly config: BundlerConfig,
    readonly provider: JsonRpcProvider,
    readonly wallet: Signer
  ) {
    this.appPublic = express()
    this.appPrivate = express()
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.initializeExpressApp(this.appPublic, this.getRpc(this.handleRpcPublic.bind(this)))
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.initializeExpressApp(this.appPrivate, this.getRpc(this.handleRpcPrivate.bind(this)))

    this.httpServerPublic = this.appPublic.listen(this.config.port)
    this.httpServerPrivate = this.appPrivate.listen(this.config.privateApiPort)

    this.startingPromise = this._preflightCheck()
  }

  private initializeExpressApp (app: Express, handler: RequestHandler): void {
    app.use(cors())
    app.use(bodyParser.json())

    app.get('/', this.intro.bind(this))
    app.post('/', this.intro.bind(this))

    app.post('/rpc', handler)
  }

  startingPromise: Promise<void>

  async asyncStart (): Promise<void> {
    await this.startingPromise
  }

  async stop (): Promise<void> {
    this.httpServerPublic.close()
    this.httpServerPrivate.close()
  }

  async _preflightCheck (): Promise<void> {
    if (this.config.rip7560) {
      // TODO: implement preflight checks for the RIP-7560 mode
      return
    }
    if (await this.provider.getCode(this.config.entryPoint) === '0x') {
      this.fatal(`entrypoint not deployed at ${this.config.entryPoint}`)
    }

    // minimal UserOp to revert with "FailedOp"
    const emptyUserOp: UserOperation = {
      sender: AddressZero,
      callData: '0x',
      nonce: 0,
      preVerificationGas: 0,
      verificationGasLimit: 100000,
      callGasLimit: 0,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      signature: '0x'
    }
    // await EntryPoint__factory.connect(this.config.entryPoint,this.provider).callStatic.addStake(0)
    try {
      await IEntryPoint__factory.connect(this.config.entryPoint, this.provider).callStatic.getUserOpHash(packUserOp(emptyUserOp))
    } catch (e: any) {
      this.fatal(`Invalid entryPoint contract at ${this.config.entryPoint}. wrong version? ${decodeRevertReason(e, false) as string}`)
    }

    const signerAddress = await this.wallet.getAddress()
    const bal = await this.provider.getBalance(signerAddress)
    this.log('signer', signerAddress, 'balance', utils.formatEther(bal))
    if (bal.eq(0)) {
      this.fatal('cannot run with zero balance')
    } else if (bal.lt(parseEther(this.config.minBalance))) {
      this.log('WARNING: initial balance below --minBalance ', this.config.minBalance)
    }
  }

  fatal (msg: string): never {
    console.error('FATAL:', msg)
    process.exit(1)
  }

  intro (req: Request, res: Response): void {
    res.send(`Account-Abstraction Bundler v.${erc4337RuntimeVersion}. please use "/rpc"`)
  }

  // TODO: I don't see how to elegantly combine express callbacks with classes so I ended up with this spaghetti.
  //  This is temporary and probably should not be merged like that, we need to simplify the flow.
  getRpc (handleRpc: any): any {
    const rpc = async (req: Request, res: Response): Promise<void> => {
      let resContent: any
      if (Array.isArray(req.body)) {
        resContent = []
        for (const reqItem of req.body) {
          resContent.push(await handleRpc(reqItem))
        }
      } else {
        resContent = await handleRpc(req.body)
      }

      try {
        res.send(resContent)
      } catch (err: any) {
        const error = {
          message: err.message,
          data: err.data,
          code: err.code
        }
        this.log('failed: ', 'rpc::res.send()', 'error:', JSON.stringify(error))
      }
    }
    return rpc.bind(this)
  }

  // TODO: deduplicate!
  async handleRpcPublic (reqItem: any): Promise<any> {
    const { method, jsonrpc, id } = reqItem

    if (method === 'aa_getRip7560Bundle') {
      const error = {
        message: `requested RPC method (${method as string}) is not available`,
        data: '',
        code: ValidationErrors.InvalidRequest
      }
      return {
        jsonrpc,
        id,
        error
      }
    }
    return await this.handleRpc(reqItem)
  }

  // TODO: deduplicate!
  async handleRpcPrivate (reqItem: any): Promise<any> {
    const { method, jsonrpc, id } = reqItem

    if (method !== 'aa_getRip7560Bundle') {
      const error = {
        message: `requested RPC method (${method as string}) is not available`,
        data: '',
        code: ValidationErrors.InvalidRequest
      }
      return {
        jsonrpc,
        id,
        error
      }
    }
    return await this.handleRpc(reqItem)
  }

  async handleRpc (reqItem: any): Promise<any> {
    const {
      method,
      params,
      jsonrpc,
      id
    } = reqItem
    debug('>>', { jsonrpc, id, method, params })
    try {
      const handleResult = await this.handleMethod(method, params)
      const result = deepHexlify(handleResult)
      debug('sent', method, '-', result)
      debug('<<', { jsonrpc, id, result })
      return {
        jsonrpc,
        id,
        result
      }
    } catch (err: any) {
      // Try unwrapping RPC error codes wrapped by the Ethers.js library
      if (err.error instanceof Error) {
        // eslint-disable-next-line no-ex-assign
        err = err.error
      }
      const error = {
        message: err.message,
        data: err.data,
        code: err.code
      }
      this.log('failed: ', method, 'error:', JSON.stringify(error), err)
      debug('<<', { jsonrpc, id, error })
      return {
        jsonrpc,
        id,
        error
      }
    }
  }

  async handleMethod (method: string, params: any[]): Promise<any> {
    let result: any
    switch (method) {
      /** RIP-7560 specific RPC API */
      case 'aa_getRip7560Bundle': {
        if (!this.config.rip7560) {
          throw new RpcError(`Method ${method} is not supported`, -32601)
        }
        const [bundle] = await this.methodHandlerRip7560.getRip7560Bundle(
          params[0].MinBaseFee, params[0].MaxBundleGas, params[0].MaxBundleSize
        )
        // TODO: provide a correct value for 'validForBlock'
        result = { bundle, validForBlock: '0x0' }
        break
      }
      case 'eth_sendTransaction':
        if (!this.config.rip7560) {
          throw new RpcError(`Method ${method} is not supported`, -32601)
        }
        if (params[0].sender != null) {
          result = await this.methodHandlerRip7560.sendRIP7560Transaction(params[0], false)
        }
        break
      case 'debug_bundler_sendTransactionSkipValidation':
        if (!this.config.rip7560) {
          throw new RpcError(`Method ${method} is not supported`, -32601)
        }
        if (params[0].sender != null) {
          result = await this.methodHandlerRip7560.sendRIP7560Transaction(params[0], true)
        }
        break
      case 'eth_getRip7560TransactionDebugInfo':
        result = await this.provider.send('eth_getRip7560TransactionDebugInfo', [params[0]])
        break
      case 'eth_getTransactionReceipt':
        if (!this.config.rip7560) {
          throw new RpcError(`Method ${method} is not supported`, -32601)
        }
        result = await this.methodHandlerRip7560.getRIP7560TransactionReceipt(params[0])
        break
      /** EIP-4337 specific RPC API */
      case 'eth_chainId':
        // eslint-disable-next-line no-case-declarations
        const { chainId } = await this.provider.getNetwork()
        result = chainId
        break
      case 'eth_supportedEntryPoints':
        result = await this.methodHandler.getSupportedEntryPoints()
        break
      case 'eth_sendUserOperation':
        result = await this.methodHandler.sendUserOperation(params[0], params[1])
        break
      case 'eth_estimateUserOperationGas':
        result = await this.methodHandler.estimateUserOperationGas(params[0], params[1], params[2])
        break
      case 'eth_getUserOperationReceipt':
        result = await this.methodHandler.getUserOperationReceipt(params[0])
        break
      case 'eth_getUserOperationByHash':
        result = await this.methodHandler.getUserOperationByHash(params[0])
        break
      case 'web3_clientVersion':
        result = this.methodHandler.clientVersion()
        break
      case 'debug_bundler_clearState':
        this.debugHandler.clearState()
        result = 'ok'
        break
      case 'debug_bundler_dumpMempool':
        result = await this.debugHandler.dumpMempool()
        break
      case 'debug_bundler_clearMempool':
        this.debugHandler.clearMempool()
        result = 'ok'
        break
      case 'debug_bundler_setReputation':
        await this.debugHandler.setReputation(params[0])
        result = 'ok'
        break
      case 'debug_bundler_dumpReputation':
        result = await this.debugHandler.dumpReputation()
        break
      case 'debug_bundler_clearReputation':
        this.debugHandler.clearReputation()
        result = 'ok'
        break
      case 'debug_bundler_setBundlingMode':
        await this.debugHandler.setBundlingMode(params[0])
        result = 'ok'
        break
      case 'debug_bundler_setBundleInterval':
        await this.debugHandler.setBundleInterval(params[0], params[1])
        result = 'ok'
        break
      case 'debug_bundler_sendBundleNow':
        result = await this.debugHandler.sendBundleNow()
        if (result == null) {
          result = 'ok'
        }
        break
      case 'debug_bundler_getStakeStatus':
        result = await this.debugHandler.getStakeStatus(params[0], params[1])
        break
      case 'debug_bundler_setConfiguration': {
        const pvgc = await this.debugHandler._setConfiguration(params[0])
        this.methodHandler.preVerificationGasCalculator = pvgc
      }
        result = {}
        break
      default:
        throw new RpcError(`Method ${method} is not supported`, -32601)
    }
    return result
  }

  log (...params: any[]): void {
    if (!this.silent) {
      console.log(...arguments)
    }
  }
}
