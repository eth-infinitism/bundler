import { JsonRpcProvider } from '@ethersproject/providers'
import { ethers } from 'ethers'
import { hexValue } from 'ethers/lib/utils'

import { UserOperation } from '@erc4337/common/dist/src/UserOperation'

export class HttpRpcClient {
  private readonly userOpJsonRpcProvider: JsonRpcProvider

  constructor (
    readonly bundlerUrl: string,
    readonly entryPointAddress: string,
    readonly chainId: number
  ) {
    const rpcUrl = this.bundlerUrl + '/rpc'
    this.userOpJsonRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl, {
      name: 'Not actually connected to network, only talking to the Bundler!',
      chainId
    })
  }

  async sendUserOpToBundler (userOp: UserOperation): Promise<any> {
    const hexifiedUserOp: any =
      Object.keys(userOp)
        .map(key => {
          let val = (userOp as any)[key]
          if (typeof val !== 'string' || !val.startsWith('0x')) {
            val = hexValue(val)
          }
          return [key, val]
        })
        .reduce((set, [k, v]) => ({ ...set, [k]: v }), {})

    const jsonRequestData: [UserOperation, string] = [hexifiedUserOp, this.entryPointAddress]
    this.printUserOperation(jsonRequestData)
    return await this.userOpJsonRpcProvider
      .send('eth_sendUserOperation', [hexifiedUserOp, this.entryPointAddress])
  }

  private printUserOperation ([userOp, entryPointAddress]: [UserOperation, string]): void {
    console.log('sending eth_sendUserOperation', {
      ...userOp,
      initCode: (userOp.initCode ?? '').length,
      callData: (userOp.callData ?? '').length
    }, entryPointAddress)
  }
}
