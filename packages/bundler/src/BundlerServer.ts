import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, Response, Request } from 'express'
import { Provider } from '@ethersproject/providers'
import { Wallet, utils } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

import { AddressZero, deepHexlify, erc4337RuntimeVersion } from '@account-abstraction/utils'

import { BundlerConfig } from './BundlerConfig'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { Server } from 'http'
import { RpcError } from './utils'
import { EntryPoint__factory, UserOperationStruct } from '@account-abstraction/contracts'
import { DebugMethodHandler } from './DebugMethodHandler'

import Debug from 'debug'

const debug = Debug('aa.rpc')
export class BundlerServer {
  app: Express
  private readonly httpServer: Server

  constructor (
    readonly methodHandler: UserOpMethodHandler,
    readonly debugHandler: DebugMethodHandler,
    readonly config: BundlerConfig,
    readonly provider: Provider,
    readonly wallet: Wallet
  ) {
    this.app = express()
    this.app.use(cors())
    this.app.use(bodyParser.json())

    this.app.get('/', this.intro.bind(this))
    this.app.post('/', this.intro.bind(this))

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.app.post('/rpc', this.rpc.bind(this))

    this.httpServer = this.app.listen(this.config.port)
    this.startingPromise = this._preflightCheck()
  }

  startingPromise: Promise<void>

  async asyncStart (): Promise<void> {
    await this.startingPromise
  }

  async stop (): Promise<void> {
    this.httpServer.close()
  }

  async _preflightCheck (): Promise<void> {
    if (await this.provider.getCode(this.config.entryPoint) === '0x') {
      this.fatal(`entrypoint not deployed at ${this.config.entryPoint}`)
    }

    // minimal UserOp to revert with "FailedOp"
    const emptyUserOp: UserOperationStruct = {
      sender: AddressZero,
      callData: '0x',
      initCode: AddressZero,
      paymasterAndData: '0x',
      nonce: 0,
      preVerificationGas: 0,
      verificationGasLimit: 100000,
      callGasLimit: 0,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0,
      signature: '0x'
    }
    // await EntryPoint__factory.connect(this.config.entryPoint,this.provider).callStatic.addStake(0)
    const err = await EntryPoint__factory.connect(this.config.entryPoint, this.provider).callStatic.simulateValidation(emptyUserOp)
      .catch(e => e)
    if (err?.errorName !== 'FailedOp') {
      this.fatal(`Invalid entryPoint contract at ${this.config.entryPoint}. wrong version?`)
    }
    const bal = await this.provider.getBalance(this.wallet.address)
    console.log('signer', this.wallet.address, 'balance', utils.formatEther(bal))
    if (bal.eq(0)) {
      this.fatal('cannot run with zero balance')
    } else if (bal.lt(parseEther(this.config.minBalance))) {
      console.log('WARNING: initial balance below --minBalance ', this.config.minBalance)
    }
  }

  fatal (msg: string): never {
    console.error('FATAL:', msg)
    process.exit(1)
  }

  intro (req: Request, res: Response): void {
    res.send(`Account-Abstraction Bundler v.${erc4337RuntimeVersion}. please use "/rpc"`)
  }

  async rpc (req: Request, res: Response): Promise<void> {
    const {
      method,
      params,
      jsonrpc,
      id
    } = req.body
    debug('>>', { jsonrpc, id, method, params })
    try {
      const result = deepHexlify(await this.handleMethod(method, params))
      console.log('sent', method, '-', result)
      debug('<<', { jsonrpc, id, result })
      res.send({
        jsonrpc,
        id,
        result
      })
    } catch (err: any) {
      const error = {
        message: err.message,
        data: err.data,
        code: err.code
      }
      console.log('failed: ', method, 'error:', JSON.stringify(error))
      debug('<<', { jsonrpc, id, error })

      res.send({
        jsonrpc,
        id,
        error
      })
    }
  }

  async handleMethod (method: string, params: any[]): Promise<any> {
    let result: any
    switch (method) {
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
        result = await this.methodHandler.estimateUserOperationGas(params[0], params[1])
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
      case 'debug_bundler_setReputation':
        await this.debugHandler.setReputation(params[0])
        result = 'ok'
        break
      case 'debug_bundler_dumpReputation':
        result = await this.debugHandler.dumpReputation()
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
      default:
        throw new RpcError(`Method ${method} is not supported`, -32601)
    }
    return result
  }
}
