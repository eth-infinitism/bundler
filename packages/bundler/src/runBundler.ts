import { program } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common'
import { ethers, utils, Wallet } from 'ethers'
import { formatEther, parseEther } from 'ethers/lib/utils'
import fs from 'fs'
import { BundlerConfig } from './BundlerConfig'

program
  .version(erc4337RuntimeVersion)
  .parse()

console.log(program.opts().separator)

export async function preflightCheck (): Promise<void> {
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
}

const CONFIG_FILE_NAME = 'bundler.config.json'

function readConfigFile () {
  const config: BundlerConfig = JSON.parse(fs.readFileSync(CONFIG_FILE_NAME, 'ascii'))

  const provider = ethers.getDefaultProvider(config.network)

  const mnemonic = fs.readFileSync(getParam('mnemonic'), 'ascii').trim()
  const signer = Wallet.fromMnemonic(mnemonic).connect(provider)

  const beneficiary = getParam('beneficiary', signer.address)

// TODO: this is "hardhat deploy" deterministic address.
  const helperAddress = getParam('helper', DefaultBundlerHelperAddress)
  const minBalance = parseEther(getParam('minBalance', '0'))
  const gasFactor = parseFloat(getParam('gasFactor', 1))
  const port = getParam('port', 3000)
}

async function main (): Promise<void> {
  const port: number

  console.log('connected to network', await provider.getNetwork().then(net => {
    return { name: net.name, chainId: net.chainId }
  }))
  console.log(`running on http://localhost:${port}`)
}
