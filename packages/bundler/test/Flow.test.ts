import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import hre, { ethers } from 'hardhat'
import path from 'path'
import sinon from 'sinon'

import * as SampleRecipientArtifact
  from '@erc4337/common/artifacts/contracts/test/SampleRecipient.sol/SampleRecipient.json'

import { BundlerConfig } from '../src/BundlerConfig'
import { ClientConfig } from '@erc4337/client/dist/src/ClientConfig'
import { JsonRpcProvider } from '@ethersproject/providers'
import { newProvider } from '@erc4337/client/dist/src'
import { Signer } from 'ethers'
import { ERC4337EthersSigner } from '@erc4337/client/dist/src/ERC4337EthersSigner'
import { ERC4337EthersProvider } from '@erc4337/client/dist/src/ERC4337EthersProvider'

const { expect } = chai.use(chaiAsPromised)

export async function startBundler (options: BundlerConfig): Promise<ChildProcessWithoutNullStreams> {
  const args: any[] = []
  args.push('--beneficiary', options.beneficiary)
  args.push('--entryPoint', options.entryPoint)
  args.push('--gasFactor', options.gasFactor)
  args.push('--helper', options.helper)
  args.push('--minBalance', options.minBalance)
  args.push('--mnemonic', options.mnemonic)
  args.push('--network', options.network)
  args.push('--port', options.port)
  const runServerPath = path.resolve(__dirname, '../dist/src/runBundler.js')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('./node_modules/.bin/ts-node',
    [runServerPath, ...args])

  const relaylog = (msg: string): void =>
    msg.split('\n').forEach(line => console.log(`relay-${proc.pid?.toString()}> ${line}`))

  await new Promise((resolve, reject) => {
    let lastResponse: string
    const listener = (data: any): void => {
      const str = data.toString().replace(/\s+$/, '')
      lastResponse = str
      relaylog(str)
      if (str.indexOf('connected to network ') >= 0) {
        // @ts-ignore
        proc.alreadystarted = 1
        resolve(proc)
      }
    }
    proc.stdout.on('data', listener)
    proc.stderr.on('data', listener)
    const doaListener = (code: Object): void => {
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (!proc.alreadystarted) {
        relaylog(`died before init code=${JSON.stringify(code)}`)
        reject(new Error(lastResponse))
      }
    }
    proc.on('exit', doaListener.bind(proc))
  })
  return proc
}

export function stopBundler (proc: ChildProcessWithoutNullStreams): void {
  proc?.kill()
}

describe('Flow', function () {
  let relayproc: ChildProcessWithoutNullStreams
  let entryPointAddress: string
  let sampleRecipientAddress: string
  let signer: Signer

  before(async function () {
    signer = await hre.ethers.provider.getSigner()
    const beneficiary = await signer.getAddress()

    // TODO: extract to Hardhat Fixture and reuse across test file
    const SingletonFactoryFactory = await ethers.getContractFactory('SingletonFactory')
    const singletonFactory = await SingletonFactoryFactory.deploy()

    const sampleRecipientFactory = await ethers.getContractFactory('SampleRecipient')
    const sampleRecipient = await sampleRecipientFactory.deploy()
    sampleRecipientAddress = sampleRecipient.address

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPointFactory.deploy(singletonFactory.address, 1, 1)
    entryPointAddress = entryPoint.address

    const bundleHelperFactory = await ethers.getContractFactory('BundlerHelper')
    const bundleHelper = await bundleHelperFactory.deploy()
    await signer.sendTransaction({
      to: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
      value: 10e18.toString()
    })

    relayproc = await startBundler({
      beneficiary,
      entryPoint: entryPoint.address,
      helper: bundleHelper.address,
      gasFactor: '1',
      minBalance: '0',
      mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect',
      network: 'http://localhost:8545/',
      port: '5555'
    })
  })

  after(async function () {
    stopBundler(relayproc)
  })

  let erc4337Signer: ERC4337EthersSigner
  let erc4337Provider: ERC4337EthersProvider

  it('should send transaction and make profit', async function () {
    const config: ClientConfig = {
      entryPointAddress,
      bundlerUrl: 'http://localhost:5555',
      chainId: 31337
    }
    erc4337Provider = await newProvider(
      new JsonRpcProvider('http://localhost:8545/'),
      config
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

  it('should refuse transaction that does not make profit', async function () {
    sinon.stub(erc4337Signer, 'signUserOperation').returns(Promise.resolve('0x' + '01'.repeat(65)))
    const sampleRecipientContract =
      new ethers.Contract(sampleRecipientAddress, SampleRecipientArtifact.abi, erc4337Signer)
    console.log(sampleRecipientContract.address)
    await expect(sampleRecipientContract.something('hello world')).to.be.eventually
      .rejectedWith(
        'The bundler has failed to include UserOperation in a batch:  "ECDSA: invalid signature \'v\' value"')
  })
})
