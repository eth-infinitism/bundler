import bodyParser from 'body-parser'
import cors from 'cors'
import express, { Express, Response, Request } from 'express'
import { JsonRpcRequest } from 'hardhat/types'
import { Provider } from '@ethersproject/providers'
import { Wallet, utils } from 'ethers'
import { hexlify } from 'ethers/lib/utils'

import { erc4337RuntimeVersion } from '@erc4337/common/dist/src/Version'

import { BundlerConfig } from './BundlerConfig'
import { UserOpMethodHandler } from './UserOpMethodHandler'

export class BundlerServer {
  app: Express

  constructor (
    readonly methodHandler: UserOpMethodHandler,
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

    this.app.listen(this.config.port)
  }

  async preflightCheck (): Promise<void> {
    const bal = await this.provider.getBalance(this.wallet.address)
    console.log('signer', this.wallet.address, 'balance', utils.formatEther(bal))
    if (bal.eq(0)) {
      this.fatal('cannot run with zero balance')
    } else if (bal.lte(this.config.minBalance)) {
      console.log('WARNING: initial balance below --minBalance ', utils.formatEther(this.config.minBalance))
    }

    if (await this.provider.getCode(this.config.helper) === '0x') {
      this.fatal('helper not deployed. run "hardhat deploy --network ..."')
    }
  }

  fatal (msg: string): never {
    console.error('fatal:', msg)
    process.exit(1)
  }

  intro (req: Request, res: Response): void {
    res.send(`Account-Abstraction Bundler v.${erc4337RuntimeVersion}. please use "/rpc"`)
  }

  async rpc (req: Request, res: Response): Promise<void> {
    const { method, params, jsonrpc, id }: JsonRpcRequest = req.body
    try {
      const result = await this.handleMethod(method, params)
      console.log('sent', method, '-', result)
      res.send({ jsonrpc, id, result })
    } catch (err: any) {
      const error = { message: err.error?.reason ?? err.error.message ?? err, code: -32000 }
      console.log('failed: ', method, JSON.stringify(error))
      res.send({ jsonrpc, id, error })
    }
  }

  async handleMethod (method: string, params: any[]): Promise<void> {
    let result: any
    switch (method) {
      case 'eth_chainId':
        // eslint-disable-next-line no-case-declarations
        const { chainId } = await this.provider.getNetwork()
        result = hexlify(chainId)
        break
      case 'eth_supportedEntryPoints':
        result = await this.methodHandler.getSupportedEntryPoints()
        break
      case 'eth_sendUserOperation':
        result = await this.methodHandler.sendUserOperation(params[0], params[1])
        break
      default:
        throw new Error(`Method ${method} is not supported`)
    }
    return result
  }
}
