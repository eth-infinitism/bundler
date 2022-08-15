import childProcess, { ChildProcessWithoutNullStreams } from 'child_process'
import path from 'path'
import hre, { ethers } from 'hardhat'

import { BundlerConfig } from '../src/BundlerConfig'

export async function startBundler (options: BundlerConfig): Promise<ChildProcessWithoutNullStreams> {
  const args: any[] = []
  args.push('--beneficiary', options.beneficiary)
  args.push('--entryPoint', options.entryPoint)
  args.push('--gasFactor', options.gasFactor)
  args.push('--helper', options.helper)
  args.push('--minBalance', options.minBalance)
  args.push('--mnemonic', options.mnemonic)
  args.push('--network', options.network)
  const runServerPath = path.resolve(__dirname, '../dist/src/runBundler.js')
  const proc: ChildProcessWithoutNullStreams = childProcess.spawn('./node_modules/.bin/ts-node',
    [runServerPath, ...args])

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let relaylog = function (_: string): void {}
  // if (options.relaylog) {
  //   relaylog = (msg: string) => msg.split('\n').forEach(line => console.log(`relay-${proc.pid?.toString()}> ${line}`))
  // }

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

  before(async function () {
    const signer = await hre.ethers.provider.getSigner()
    const beneficiary = await signer.getAddress()

    // TODO: extract to Hardhat Fixture and reuse across test file
    const SingletonFactoryFactory = await ethers.getContractFactory('SingletonFactory')
    const singletonFactory = await SingletonFactoryFactory.deploy()

    const EntryPointFactory = await ethers.getContractFactory('EntryPoint')
    const entryPoint = await EntryPointFactory.deploy(singletonFactory.address, 1, 1)

    await signer.sendTransaction({
      to: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
      value: 10e18.toString()
    })

    relayproc = await startBundler({
      beneficiary,
      entryPoint: entryPoint.address,
      helper: '0xdD747029A0940e46D20F17041e747a7b95A67242',
      gasFactor: '1',
      minBalance: '0',
      mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect',
      network: 'http://localhost:8545/',
      port: '8080'
    })
  })

  after(async function () {
    stopBundler(relayproc)
  })

  it('should send transaction and make profit', function () {

  })

  it('should refuse transaction that does not make profit', function () {

  })
})
