import express, { Express, Response, Request } from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import { UserOpMethodHandler } from './UserOpMethodHandler'
import { JsonRpcRequest } from 'hardhat/types'

export class BundlerServer {
  app: Express
  private methodHandler!: UserOpMethodHandler
  private port!: number

  constructor () {
    this.app = express()
    this.app.use(cors())
    this.app.use(bodyParser.json())

    this.app.get('/', this.intro.bind(this))
    this.app.post('/', this.intro.bind(this))

    this.app.post('/rpc', this.rpc.bind(this))

    this.app.listen(this.port)

  }

  intro (req: Request, res: Response): void {
    res.send('Account-Abstraction Bundler. please use "/rpc"')
  }

  async rpc (req: Request, res: Response): Promise<void> {
    const { method, params, jsonrpc, id }: JsonRpcRequest = req.body
    try {
      const result = await this.handleMethod(method, params)
      console.log('sent', method, '-', result)
      res.send({ jsonrpc, id, result })
    } catch (err: any) {
      const error = { message: err.error?.reason ?? err.error, code: -32000 }
      console.log('failed: ', method, error)
      res.send({ jsonrpc, id, error })
    }
  }

  async handleMethod (method: string, params: any[]): Promise<void> {
    let result: any
    switch (method) {
      case 'eth_chainId':
        result = await this.methodHandler.eth_chainId()
        break
      case 'eth_supportedEntryPoints':
        result = await this.methodHandler.eth_supportedEntryPoints()
        break
      case 'eth_sendUserOperation':
        result = await this.methodHandler.eth_sendUserOperation(params[0], params[1])
        break
      default:
        throw new Error(`Method ${method} is not supported`)
    }
    return result
  }
}
