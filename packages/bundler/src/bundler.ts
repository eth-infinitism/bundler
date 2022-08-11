/* eslint-disable @typescript-eslint/no-base-to-string */

import minimist from 'minimist'
import { ethers, utils, Wallet } from 'ethers'
import * as fs from 'fs'
import { formatEther, parseEther } from 'ethers/lib/utils'
import { BundlerHelper__factory, EntryPoint__factory } from '@erc4337/helper-contracts/types'

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspectCustomSymbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

// deploy with "hardhat deploy --network goerli"
const DefaultBundlerHelperAddress = '0xdD747029A0940e46D20F17041e747a7b95A67242'

const supportedEntryPoints = [
  '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69'
]

const args = minimist(process.argv.slice(2), {
  alias: {
    b: 'beneficiary',
    f: 'gasFactor',
    M: 'minBalance',
    n: 'network',
    m: 'mnemonic',
    H: 'helper',
    p: 'port'
  }
})

function fatal (msg: string): never {
  console.error('fatal:', msg)
  process.exit(1)
}

function usage (msg: string): void {
  console.log(msg)
  console.log(`
usage: yarn run bundler [options]
  --port - server listening port (default to 3000)
  --beneficiary address to receive funds (defaults to signer)
  --minBalance - below this signer balance, use itself, not --beneficiary  
  --gasFactor - require that much on top of estimated gas (default=1)
  --network - network name/url
  --mnemonic - file
  --helper - BundlerHelper contract. deploy with "hardhat deploy"
  `)
}

function getParam (name: string, defValue?: string | number): string {
  let value = args[name] ?? process.env[name] ?? defValue
  if (typeof defValue === 'number') {
    value = parseFloat(value)
  }
  if (value == null) {
    usage(`missing --${name}`)
  }
  // console.log(`getParam(${name}) = "${value}"`)
  return value
}

const provider = ethers.getDefaultProvider(getParam('network'))

const mnemonic = fs.readFileSync(getParam('mnemonic'), 'ascii').trim()
const signer = Wallet.fromMnemonic(mnemonic).connect(provider)

const beneficiary = getParam('beneficiary', signer.address)

// TODO: this is "hardhat deploy" deterministic address.
const helperAddress = getParam('helper', DefaultBundlerHelperAddress)
const minBalance = parseEther(getParam('minBalance', '0'))
const gasFactor = parseFloat(getParam('gasFactor', 1))
const port = getParam('port', 3000)

const bundlerHelper = BundlerHelper__factory.connect(helperAddress, signer)

// noinspection JSUnusedGlobalSymbols

async function main (): Promise<void> {
  const bal = await provider.getBalance(signer.address)
  console.log('signer', signer.address, 'balance', utils.formatEther(bal))
  if (bal.eq(0)) {
    fatal('cannot run with zero balance')
  } else if (bal.lte(minBalance)) {
    console.log('WARNING: initial balance below --minBalance ', formatEther(minBalance))
  }

  if (await provider.getCode(bundlerHelper.address) === '0x') {
    fatal('helper not deployed. run "hardhat deploy --network ..."')
  }


  console.log('connected to network', await provider.getNetwork().then(net => {
    return { name: net.name, chainId: net.chainId }
  }))
  console.log(`running on http://localhost:${port}`)
}

main()
  .catch(e => console.log(e))
