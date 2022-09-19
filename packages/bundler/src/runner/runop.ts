// runner script, to create

/**
 * a simple script runner, to test the bundler and API.
 * for a simple target method, we just call the "nonce" method of the wallet itself.
 */

import { getDefaultProvider, Signer, Wallet } from 'ethers'
import { HttpRpcClient } from '@account-abstraction/sdk/dist/src/HttpRpcClient'
import { JsonRpcProvider } from '@ethersproject/providers'
import { SimpleWalletAPI } from '@account-abstraction/sdk'
import { DeterministicDeployer } from '@account-abstraction/sdk/dist/src/DeterministicDeployer'
import { SimpleWalletDeployer__factory } from '@account-abstraction/contracts'
import { formatEther, keccak256 } from 'ethers/lib/utils'

const ENTRY_POINT = '0x674DF207855CE0d9eaB7B000FbBE997a2451d24f'

class Runner {
  private bundlerProvider!: HttpRpcClient
  private walletApi!: SimpleWalletAPI

  /**
   *
   * @param provider - a provider for initialization. This account is used to fund the created wallet, but it is not the wallet or its owner.
   * @param bundlerUrl - a URL to a running bundler. must point to the same network the provider is.
   * @param walletOwner - the wallet signer account. used only as signer (not as transaction sender)
   * @param entryPointAddress - the entrypoint address to use.
   * @param index - unique salt, to allow multiple wallets with the same owner
   */
  constructor (
    readonly provider: JsonRpcProvider,
    readonly bundlerUrl: string,
    readonly walletOwner: Signer,
    readonly entryPointAddress = ENTRY_POINT,
    readonly index = 0
  ) {
  }

  async getAddress (): Promise<string> {
    return await this.walletApi.getWalletAddress()
  }

  async init (): Promise<this> {
    const net = await this.provider.getNetwork()
    const chainId = net.chainId
    const dep = new DeterministicDeployer(this.provider)
    const walletDeployer = await dep.deterministicDeploy(SimpleWalletDeployer__factory.bytecode)
    this.bundlerProvider = new HttpRpcClient(this.bundlerUrl, this.entryPointAddress, chainId)
    this.walletApi = new SimpleWalletAPI(
      this.provider,
      this.entryPointAddress,
      undefined,
      this.walletOwner,
      walletDeployer,
      this.index
    )
    return this
  }

  async runUserOp (target: string, data: string): Promise<void> {
    const userOp = await this.walletApi.createSignedUserOp({
      target,
      data
    })
    await this.bundlerProvider.sendUserOpToBundler(userOp)
  }
}

async function main (): Promise<void> {
  const provider = getDefaultProvider('http://localhost:8545') as JsonRpcProvider
  const bundlerUrl = 'http://localhost:3000/rpc'
  const walletOwner = new Wallet('0x'.padEnd(66, '1'))

  const client = await new Runner(provider, bundlerUrl, walletOwner).init()

  const addr = await client.getAddress()

  async function isDeployed (addr: string): Promise<boolean> {
    return await provider.getCode(addr).then(code => code !== '0x')
  }

  async function getBalance (addr: string): Promise<string> {
    return await provider.getBalance(addr).then(formatEther)
  }

  console.log('wallet address', addr, 'deployed=', await isDeployed(addr), 'bal=', await getBalance(addr))

  const dest = addr
  const data = keccak256(Buffer.from('nonce()')).slice(0, 10)
  console.log('data=', data)
  await client.runUserOp(dest, data)
  console.log('after run')
}

void main()
