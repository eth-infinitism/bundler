import { networks } from './config/networks'
import { Contract, ethers, EventFilter } from 'ethers'

import * as CtfArtifact from '../artifacts/contracts/CaptureTheFlag.sol/CaptureTheFlag.json'
import { JsonRpcProvider } from '@ethersproject/providers'

import { ClientConfig } from '@erc4337/client/dist/src/ClientConfig'
import { newProvider } from '@erc4337/client/dist/src'
import { ERC4337EthersSigner } from '@erc4337/client/dist/src/ERC4337EthersSigner'
import { ERC4337EthersProvider } from '@erc4337/client/dist/src/ERC4337EthersProvider'

declare let window: { ethereum: any, location: any }
declare let global: { network: any }

export interface EventInfo {
  date?: Date
  previousHolder: string
  currentHolder: string
}

/**
 * a wrapper class for the CTF contract.
 * the only network-specific "leak" from this class is that the "capture()"
 * event returns a transaction object,
 * that the application should wait() until it gets mined.
 */
export class Ctf {
  theContract: Contract

  blockDates: { [key: number]: Date } = {}

  constructor (readonly address: string, readonly signer: ERC4337EthersSigner, readonly provider: ERC4337EthersProvider, readonly chainId: number) {

    this.theContract = new ethers.Contract(address, CtfArtifact.abi, this.signer)
    this.blockDates = {}
  }

  async getCurrentFlagHolder (): Promise<string> {
    return this.theContract.currentHolder()
  }

  listenToEvents (onEvent: (e: EventInfo) => void, onProgress?: (e: any) => void): void {
    // @ts-expect-error
    const listener = async (from, to, event): Promise<void> => {
      const info = await this.getEventInfo(event)
      onEvent(info)
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.theContract.on('FlagCaptured', listener)
  }

  stopListenToEvents (onEvent?: EventFilter, onProgress = null): void {
    this.theContract.off(onEvent as any, null as any)
  }

  async getBlockDate (blockNumber: number): Promise<Date> {
    if (this.blockDates[blockNumber] == null) {
      this.blockDates[blockNumber] = new Date(await this.provider.getBlock(blockNumber).then(b => {
        return b.timestamp * 1000
      }))
    }
    return this.blockDates[blockNumber]
  }

  async getEventInfo (e: ethers.Event): Promise<EventInfo> {
    if (e.args == null) {
      return {
        previousHolder: 'notevent',
        currentHolder: JSON.stringify(e)
      }
    }
    return {
      date: await this.getBlockDate(e.blockNumber),
      previousHolder: e.args.previousHolder,
      currentHolder: e.args.currentHolder
    }
  }

  async getPastEvents (count = 5): Promise<EventInfo[]> {
    const currentBlock = (await this.provider.getBlockNumber()) - 1
    // look at most one month back (in 12-second block
    const lookupWindow = global.network?.relayLookupWindowBlocks ?? 30 * 24 * 3600 / 12
    const startBlock = Math.max(1, currentBlock - lookupWindow)

    const logs = await this.theContract.queryFilter(this.theContract.filters.FlagCaptured(), startBlock)
      .catch(e => [])
    return await Promise.all(logs.slice(-count).map(async e => await this.getEventInfo(e)))
  }

  async getSigner (): Promise<string> {
    return await this.theContract.signer.getAddress()
  }

  async capture (): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.provider.getGasPrice().then(price => console.log('== gas price=', price.toString()))
    const gasFees = await this.provider.getFeeData()
    gasFees.maxPriorityFeePerGas = gasFees.maxFeePerGas
    console.log('gas fees=', gasFees)
    const gasLimit = 1e6
    const ret = await this.theContract.captureTheFlag({ gasLimit, ...gasFees })
    console.log('post-capture ret=', ret)
    return ret
  }
}

export async function switchNetwork (id: string): Promise<void> {
  // hexlify and even "hexlify(parseInt(id))" doesn't work for "5"
  const hexChain = '0x' + parseInt(id).toString(16)
  console.log('change network to ', hexChain)
  const provider = window.ethereum
  await provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: hexChain }]
  })
}

export function getNetworks (): { [chain: number]: string } {
  return Object.keys(networks)
    .map(key => parseInt(key))
    .filter(key => window.location.href.match(/local/) != null || (key !== 1337 && key !== 31337))
    .reduce((set, key) => ({ ...set, [key]: networks[key].name }), {})
}

export async function initCtf (): Promise<Ctf> {
  const web3Provider = window.ethereum

  if (web3Provider == null) { throw new Error('No "window.ethereum" found. do you have Metamask installed?') }

  web3Provider.on('chainChanged', (chainId: number) => {
    console.log('chainChanged', chainId)
    window.location.reload()
  })
  web3Provider.on('accountsChanged', (accs: any[]) => {
    console.log('accountChanged', accs)
    window.location.reload()
  })

  const provider = new ethers.providers.Web3Provider(web3Provider)
  const network = await provider.getNetwork()

  const chainId = network.chainId
  const net = global.network = networks[chainId]
  const netid: string = await provider.send('net_version', [])
  console.log('chainid=', chainId, 'networkid=', netid)
  if (chainId !== parseInt(netid)) { console.warn(`Incompatible network-id ${netid} and ${chainId}: for Metamask to work, they should be the same`) }
  if (net == null) {
    if (chainId.toString().match(/1337/) != null) {
      throw new Error('To run locally, you must run "yarn evm" and then "yarn deploy" before "yarn react-start" ')
    } else {
      throw new Error(`Unsupported network (chainId=${chainId}) . please switch to one of: ` + Object.values(networks).map((n: any) => n.name).filter(n => n).join(' / '))
    }
  }

  // TODO: ALEXF: read entry point from files same as everything else
  const config: ClientConfig = {
    entryPointAddress: '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69',
    bundlerUrl: 'http://localhost:5555',
    chainId: 31337
  }
  const erc4337Provider = await newProvider(
    new JsonRpcProvider('http://localhost:8545/'),
    config
  )
  const erc4337Signer = erc4337Provider.getSigner()

  return new Ctf(net.ctf, erc4337Signer, erc4337Provider, chainId)
}
