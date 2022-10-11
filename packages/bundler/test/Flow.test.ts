import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import hre, { ethers } from 'hardhat'
import sinon from 'sinon'

import * as SampleRecipientArtifact
  from '@account-abstraction/utils/artifacts/contracts/test/SampleRecipient.sol/SampleRecipient.json'

import { BundlerConfig } from '../src/BundlerConfig'
import { ERC4337EthersProvider, ERC4337EthersSigner, ClientConfig, wrapProvider } from '@account-abstraction/sdk'
import { Signer, Wallet } from 'ethers'
import { runBundler } from '../src/runBundler'
import { BundlerServer } from '../src/BundlerServer'
import fs from 'fs'

const { expect } = chai.use(chaiAsPromised)

export async function startBundler (options: BundlerConfig): Promise<BundlerServer> {
  const args: any[] = []
  args.push('--beneficiary', options.beneficiary)
  args.push('--entryPoint', options.entryPoint)
  args.push('--gasFactor', options.gasFactor)
  args.push('--helper', options.helper)
  args.push('--minBalance', options.minBalance)
  args.push('--mnemonic', options.mnemonic)
  args.push('--network', options.network)
  args.push('--port', options.port)

  return await runBundler(['node', 'cmd', ...args], true)
}

describe('Flow', function () {
  let bundlerServer: BundlerServer
  let entryPointAddress: string
  let sampleRecipientAddress: string
  let signer: Signer
  before(async function () {
    signer = await hre.ethers.provider.getSigner()
    const beneficiary = await signer.getAddress()

    const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    const sampleRecipient = await sampleRecipientFactory.deploy()
    sampleRecipientAddress = sampleRecipient.address

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPointFactory.deploy(1, 1)
    entryPointAddress = entryPoint.address

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    const bundleHelper = await bundleHelperFactory.deploy()
    await signer.sendTransaction({
      to: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
      value: 10e18.toString()
    })

    const mnemonic = 'myth like bonus scare over problem client lizard pioneer submit female collect'
    const mnemonicFile = '/tmp/mnemonic.tmp'
    fs.writeFileSync(mnemonicFile, mnemonic)
    bundlerServer = await startBundler({
      beneficiary,
      entryPoint: entryPoint.address,
      helper: bundleHelper.address,
      gasFactor: '0.2',
      minBalance: '0',
      mnemonic: mnemonicFile,
      network: 'http://localhost:8545/',
      port: '5555'
    })
  })

  after(async function () {
    await bundlerServer?.stop()
  })

  let erc4337Signer: ERC4337EthersSigner
  let erc4337Provider: ERC4337EthersProvider

  it('should send transaction and make profit', async function () {
    const config: ClientConfig = {
      entryPointAddress,
      bundlerUrl: 'http://localhost:5555/rpc'
    }

    // use this as signer (instead of node's first account)
    const ownerAccount = Wallet.createRandom()
    erc4337Provider = await wrapProvider(
      ethers.provider,
      // new JsonRpcProvider('http://localhost:8545/'),
      config,
      ownerAccount
    )
    erc4337Signer = erc4337Provider.getSigner()
    const simpleWalletPhantomAddress = await erc4337Signer.getAddress()

    await signer.sendTransaction({
      to: simpleWalletPhantomAddress,
      value: 10e18.toString()
    })

    const sampleRecipientContract =
      new ethers.Contract(sampleRecipientAddress, SampleRecipientArtifact.abi, erc4337Signer)
    console.log(sampleRecipientContract.address)

    const result = await sampleRecipientContract.something('hello world')
    console.log(result)
    const receipt = await result.wait()
    console.log(receipt)
  })

  it.skip('should refuse transaction that does not make profit', async function () {
    sinon.stub(erc4337Signer, 'signUserOperation').returns(Promise.resolve('0x' + '01'.repeat(65)))
    const sampleRecipientContract =
      new ethers.Contract(sampleRecipientAddress, SampleRecipientArtifact.abi, erc4337Signer)
    console.log(sampleRecipientContract.address)
    await expect(sampleRecipientContract.something('hello world')).to.be.eventually
      .rejectedWith(
        'The bundler has failed to include UserOperation in a batch:  "ECDSA: invalid signature \'v\' value"')
  })
})
