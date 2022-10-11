import { JsonRpcProvider } from '@ethersproject/providers'
import { ethers } from 'ethers'
import { hexValue, resolveProperties } from 'ethers/lib/utils'
import { UserOperationStruct } from '@account-abstraction/contracts'
import Debug from 'debug'

const debug = Debug('aa.rpc')

export class HttpRpcClient {
  private readonly userOpJsonRpcProvider: JsonRpcProvider

  initializing: Promise<void>

  constructor (
    readonly bundlerUrl: string,
    readonly entryPointAddress: string,
    readonly chainId: number
  ) {
    this.userOpJsonRpcProvider = new ethers.providers.JsonRpcProvider(this.bundlerUrl, {
      name: 'Connected bundler network',
      chainId
    })
    this.initializing = this.validateChainId()
  }

  async validateChainId (): Promise<void> {
    // validate chainId is in sync with expected chainid
    const chain = await this.userOpJsonRpcProvider.send('eth_chainId', [])
    const bundlerChain = parseInt(chain)
    if (bundlerChain !== this.chainId) {
      throw new Error(`bundler ${this.bundlerUrl} is on chainId ${bundlerChain}, but provider is on chainId ${this.chainId}`)
    }
  }

  /**
   * send a UserOperation to the bundler
   * @param userOp1
   * @return requestId the id of this operation, for getUserOperationTransaction
   */
  async sendUserOpToBundler (userOp1: UserOperationStruct): Promise<string> {
    await this.initializing
    const userOp = await resolveProperties(userOp1)
    const hexifiedUserOp: any =
      Object.keys(userOp)
        .map(key => {
          let val = (userOp as any)[key]
          if (typeof val !== 'string' || !val.startsWith('0x')) {
            val = hexValue(val)
          }
          return [key, val]
        })
        .reduce((set, [k, v]) => ({
          ...set,
          [k]: v
        }), {})

    const jsonRequestData: [UserOperationStruct, string] = [hexifiedUserOp, this.entryPointAddress]
    await this.printUserOperation(jsonRequestData)
    return await this.userOpJsonRpcProvider
      .send('eth_sendUserOperation', [hexifiedUserOp, this.entryPointAddress])
  }

  private async printUserOperation ([userOp1, entryPointAddress]: [UserOperationStruct, string]): Promise<void> {
    const userOp = await resolveProperties(userOp1)
    debug('sending eth_sendUserOperation', {
      ...userOp
      // initCode: (userOp.initCode ?? '').length,
      // callData: (userOp.callData ?? '').length
    }, entryPointAddress)
  }
}
