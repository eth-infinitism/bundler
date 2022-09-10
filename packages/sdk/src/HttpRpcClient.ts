import { JsonRpcProvider } from '@ethersproject/providers'
import { ethers } from 'ethers'
import { hexValue, resolveProperties } from 'ethers/lib/utils'

import { UserOperationStruct } from '@account-abstraction/contracts'

export class HttpRpcClient {
  private readonly userOpJsonRpcProvider: JsonRpcProvider

  constructor (
    readonly bundlerUrl: string,
    readonly entryPointAddress: string,
    readonly chainId: number
  ) {
    this.userOpJsonRpcProvider = new ethers.providers.JsonRpcProvider(this.bundlerUrl, {
      name: 'Not actually connected to network, only talking to the Bundler!',
      chainId
    })
  }

  async sendUserOpToBundler (userOp1: UserOperationStruct): Promise<any> {
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
        .reduce((set, [k, v]) => ({ ...set, [k]: v }), {})

    const jsonRequestData: [UserOperationStruct, string] = [hexifiedUserOp, this.entryPointAddress]
    await this.printUserOperation(jsonRequestData)
    return await this.userOpJsonRpcProvider
      .send('eth_sendUserOperation', [hexifiedUserOp, this.entryPointAddress])
  }

  private async printUserOperation ([userOp1, entryPointAddress]: [UserOperationStruct, string]): Promise<void> {
    const userOp = await resolveProperties(userOp1)
    console.log('sending eth_sendUserOperation', {
      ...userOp
      // initCode: (userOp.initCode ?? '').length,
      // callData: (userOp.callData ?? '').length
    }, entryPointAddress)
  }
}
