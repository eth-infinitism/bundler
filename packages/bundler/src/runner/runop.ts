// runner script, to create

/**
 * a simple script runner, to test the bundler and API.
 * for a simple target method, we just call the "nonce" method of the wallet itself.
 */

import { BigNumber, getDefaultProvider, Signer, Wallet } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'
import { SimpleWalletDeployer__factory } from '@account-abstraction/contracts'
import { formatEther, keccak256, parseEther } from 'ethers/lib/utils'
import { Command } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common'
import fs from 'fs'
import { HttpRpcClient } from '@account-abstraction/sdk/dist/src/HttpRpcClient'
import { SimpleWalletAPI } from '@account-abstraction/sdk'
import { DeterministicDeployer } from '@account-abstraction/sdk/dist/src/DeterministicDeployer'

const ENTRY_POINT = '0x674DF207855CE0d9eaB7B000FbBE997a2451d24f'

class Runner {
  bundlerProvider!: HttpRpcClient
  walletApi!: SimpleWalletAPI

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
    // const walletDeployer = await dep.deterministicDeploy(SimpleWalletDeployer__factory.bytecode)
    const walletDeployer = await new SimpleWalletDeployer__factory(this.provider.getSigner()).deploy()
    this.bundlerProvider = new HttpRpcClient(this.bundlerUrl, this.entryPointAddress, chainId)
    this.walletApi = new SimpleWalletAPI({
      provider: this.provider,
      entryPointAddress: this.entryPointAddress,
      factoryAddress: walletDeployer.address,
      owner: this.walletOwner,
      index: this.index,
      overheads: {
        // perUserOp: 100000
      }
    })
    return this
  }

  parseExpectedGas (e: Error): Error {
    // parse a custom error generated by the BundlerHelper, which gives a hint of how much payment is missing
    const match = e.message?.match(/paid (\d+) expected (\d+)/)
    if (match != null) {
      const paid = Math.floor(parseInt(match[1]) / 1e9)
      const expected = Math.floor(parseInt(match[2]) / 1e9)
      return new Error(`Error: Paid ${paid}, expected ${expected} . Paid ${Math.floor(paid / expected * 100)}%, missing ${expected - paid} `)
    }
    return e
  }

  async runUserOp (target: string, data: string): Promise<void> {
    const userOp = await this.walletApi.createSignedUserOp({
      target,
      data
    })
    try {
      await this.bundlerProvider.sendUserOpToBundler(userOp)
    } catch (e: any) {
      console.log(this.parseExpectedGas(e))
    }
  }
}

async function main (): Promise<void> {
  const program = new Command()
    .version(erc4337RuntimeVersion)
    .option('--network <string>', 'network name or url', 'http://localhost:8545')
    .option('--mnemonic <file>', 'mnemonic/private-key file of signer account (to fund wallet)')
    .option('--bundlerUrl <url>', 'bundler URL', 'http://localhost:3000/rpc')
    .option('--entryPoint <string>', 'address of the supported EntryPoint contract', ENTRY_POINT)
    .option('--show-stack-traces', 'Show stack traces.')

  const opts = program.parse().opts()
  const provider = getDefaultProvider('http://localhost:8545') as JsonRpcProvider
  const signer = opts.mnemonic == null ? provider.getSigner() : Wallet.fromMnemonic(fs.readFileSync(opts.mnemonic, 'ascii').trim())
  const walletOwner = new Wallet('0x'.padEnd(66, '1'))

  const client = await new Runner(provider, opts.bundlerUrl, walletOwner).init()

  const addr = await client.getAddress()

  async function isDeployed (addr: string): Promise<boolean> {
    return await provider.getCode(addr).then(code => code !== '0x')
  }

  async function getBalance (addr: string): Promise<BigNumber> {
    return await provider.getBalance(addr)
  }

  const bal = await getBalance(addr)
  console.log('wallet address', addr, 'deployed=', await isDeployed(addr), 'bal=', formatEther(bal))
  // TODO: actual required val
  const requiredBalance = parseEther('0.1')
  if (bal.lt(requiredBalance)) {
    console.log('funding wallet to', requiredBalance)
    await signer.sendTransaction({
      to: addr,
      value: requiredBalance.sub(bal)
    })
  }

  const dest = addr
  const data = keccak256(Buffer.from('nonce()')).slice(0, 10)
  console.log('data=', data)
  await client.runUserOp(dest, data)
  console.log('after run1')
  // client.walletApi.overheads!.perUserOp = 30000
  await client.runUserOp(dest, data)
  console.log('after run2')
}

void main()
