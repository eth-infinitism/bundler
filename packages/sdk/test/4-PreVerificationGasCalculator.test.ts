import { PreVerificationGasCalculator } from '../src'
import {
  deployEntryPoint,
  IEntryPoint, packUserOp, rethrowWithRevertReason,
  UserOperation,
  DummyAccountFactory__factory, DummyPaymaster__factory,
  DummyAccountFactory,
  DummyPaymaster, IAccountExecute__factory, AddressZero
} from '@account-abstraction/utils'
import { ethers } from 'hardhat'
import {
  UserOperationEventEventObject
} from '@account-abstraction/utils/dist/src/types/@account-abstraction/contracts/interfaces/IEntryPoint'
import { hexConcat, parseEther } from 'ethers/lib/utils'

const provider = ethers.provider
const signer = provider.getSigner()

let verbose: boolean

// actually, all fields except "bundleSize"
const calcConfig = {
  transactionGasStipend: 21000,
  fixedGasOverhead: 9860,
  perUserOpGasOverhead: 7260,
  perUserOpWordGasOverhead: 0,
  perCallCataExtraOverhead: 9.5,
  execUserOpPerWordGasOverhead: 8.5,
  execUserOpGasOverhead: 1645,
  zeroByteGasCost: 4,
  nonZeroByteGasCost: 16,
  estimationSignatureSize: 65,
  estimationPaymasterDataSize: 0
}

const defaultUserOpFields = {
  callData: '0x01',
  callGasLimit: 30000,
  nonce: 0,
  preVerificationGas: 0,
  verificationGasLimit: 1000000,
  maxFeePerGas: 1e7,
  maxPriorityFeePerGas: 1e7,
  signature: '0x'
}

interface BundleParams {
  bundleSize: number
  callDataSize: number
  useFactory: boolean
  factoryAppendSize?: number
  sigSize: number
  pmDataSize?: number
  callDataPrefix?: string // stub to inject "executeUserOp" callData
}

class MinMaxAvg {
  min?: number
  max?: number
  tot?: number
  count?: number

  reset (): void {
    this.min = undefined
    this.max = undefined
    this.tot = undefined
  }

  stats (): string {
    return `${this.min}/${this.avg()}/${this.max} [${this.max! - this.min!}]`
  }

  avg (): number {
    return Math.round((this.tot ?? 0) / (this.count ?? 1))
  }

  addSample (n: number): void {
    if (this.min == null || n < this.min) {
      this.min = n
    }
    if (this.max == null || n > this.max) {
      this.max = n
    }
    this.tot = (this.tot ?? 0) + n
    this.count = (this.count ?? 0) + 1
  }
}

// given dict param, collect stats for each key
class StatsDict {
  dict: { [key: string]: MinMaxAvg } = {}

  reset (): void {
    this.dict = {}
  }

  add (n: any): this {
    for (const k in n) {
      if (this.dict[k] == null) {
        this.dict[k] = new MinMaxAvg()
      }
      this.dict[k].addSample(n[k])
    }
    return this
  }

  // report all modified fields (those with max!=max)
  dump (): void {
    const dump: { [key: string]: string } = {}
    for (const k in this.dict) {
      if (this.dict[k].min !== this.dict[k].max) {
        dump[k] = this.dict[k].stats()
      }
    }
    console.log(dump)
  }
}

const defaultBundleParams: BundleParams = {
  bundleSize: 1,
  callDataSize: 0,
  useFactory: false,
  sigSize: 64,
  pmDataSize: undefined
}

class PreVgChecker {
  private salt = 0
  // @ts-ignore
  private factories: DummyAccountFactory[]
  // @ts-ignore
  private paymasters: DummyPaymaster[]
  // @ts-ignore
  private beneficiary: string
  // @ts-ignore
  private entryPoint: IEntryPoint

  statsDict = new StatsDict()

  async init (): Promise<void> {
    // solves "transaction in progress" on clean geth..
    await signer.sendTransaction({ to: AddressZero })
    this.entryPoint = await deployEntryPoint(provider)

    this.factories = []
    this.paymasters = []
    for (let i = 0; i < 50; i++) {
      const factory = await new DummyAccountFactory__factory(signer).deploy(this.entryPoint.address)
      this.factories.push(factory)
      const paymaster = await new DummyPaymaster__factory(signer).deploy(this.entryPoint.address)
      this.paymasters.push(paymaster)
      await this.entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
    }

    this.beneficiary = await signer.getAddress()
  }

  async createBundle (p1: Partial<BundleParams>): Promise<UserOperation[]> {
    const p: BundleParams = { ...defaultBundleParams, ...p1 }
    const ops: UserOperation[] = []
    for (let i = 0; i < p.bundleSize; i++) {
      const factory = this.factories[i]
      const paymaster = this.paymasters[i]
      ++this.salt
      const factoryData = factory.interface.encodeFunctionData('createAccount', [this.salt])
      const accountAddress = await factory.callStatic.createAccount(this.salt)
      let pmInfo: {
        paymaster?: string
        paymasterData?: string
        paymasterPostOpGasLimit?: number
        paymasterVerificationGasLimit?: number
      } = {}
      if (p.pmDataSize == null) {
        await this.entryPoint.depositTo(accountAddress, { value: parseEther('1') })
        // await signer.sendTransaction({ to: accountAddress, value: parseEther('1') })
      } else {
        pmInfo = {
          paymaster: paymaster.address,
          paymasterData: '0x' + 'ff'.repeat(Math.max(0, p.pmDataSize - (20 + 32))),
          paymasterPostOpGasLimit: 100000,
          paymasterVerificationGasLimit: 100000
        }
      }
      if (!p.useFactory) {
        // not testing factory: create a dummy handleOps request just to create the account
        // (todo: can be batched, and create all accounts under test in a single tx..)
        const op1: UserOperation = {
          ...defaultUserOpFields,
          sender: accountAddress,
          callData: '0x',
          factory: factory.address,
          factoryData,
          nonce: 0,
          ...pmInfo
        }
        await this.entryPoint.handleOps([packUserOp(op1)], this.beneficiary)
          .catch(e => {
            console.log('op=', op1)
            rethrowWithRevertReason(e)
          })
      }
      const nonce = await this.entryPoint.getNonce(accountAddress, 0)
      const op: UserOperation = {
        sender: accountAddress,
        factory: p.useFactory ? factory.address : undefined,
        factoryData: p.useFactory ? (factoryData + 'ff'.repeat(p.factoryAppendSize ?? 0)) : undefined,
        preVerificationGas: 0,
        callGasLimit: 30000,
        verificationGasLimit: 500000,
        maxFeePerGas: 1e7,
        maxPriorityFeePerGas: 1e7,
        nonce,
        callData: hexConcat([
          p.callDataPrefix ?? '0x',
          '0x' + 'ff'.repeat(p.callDataSize)
        ]),
        signature: '0x' + 'ff'.repeat(p.sigSize),
        ...pmInfo
      }
      ops.push(op)
    }
    return ops
  }

  async sendBundle (ops: UserOperation[]): Promise<number> {
    const packed = ops.map(packUserOp)
    const ret = await this.entryPoint.handleOps(packed, this.beneficiary)
      .then(async tx => await tx.wait())
      .catch(rethrowWithRevertReason)
    let evTotalGasUsed = 0
    ret.events?.filter(e => e.event === 'UserOperationEvent').forEach((e, i) => {
      const ev = e.args as unknown as UserOperationEventEventObject
      // console.log(`size ${ops.length}  ev.gasused=${ev.actualGasUsed.toNumber()}, ${JSON.stringify(ops[i])}`)
      evTotalGasUsed += ev.actualGasUsed.toNumber()
    })
    // console.log(`size ${ops.length} min=${minEvGasUsed} max=${MaxEvGasUsed} avg=${evTotalGasUsed / ops.length} txGasUsed=${ret.gasUsed.toNumber()}`)
    const txGasUsed = ret.gasUsed.toNumber()
    const totalPreVg = txGasUsed - evTotalGasUsed
    return Math.trunc(totalPreVg / ops.length)
  }

  async checkPreVg (p: Partial<BundleParams>): Promise<number> {
    const p1: BundleParams = { ...defaultBundleParams, ...p }
    const ops = await this.createBundle(p)
    const ret = await this.sendBundle(ops)
    // console.log('==diff global')
    // new StatsDict().add(calcConfig).add(MainnetConfig).dump()
    // const calcConfig = MainnetConfig
    const calc = new PreVerificationGasCalculator({
      ...calcConfig,
      expectedBundleSize: p1.bundleSize
    })
    const calcPreVg = calc._calculate(ops[0])
    const diff = calcPreVg - ret
    this.statsDict.add({ ...p1, diff })
    if (verbose) { console.log(`check ${JSON.stringify(p)} = overhead=${ret}  calc=${calcPreVg} diff=${diff}`) }
    return ret
  }
}

describe.only('PreVerificationGasCalculator', () => {
  let c: PreVgChecker
  const executeUserOpSig = IAccountExecute__factory.createInterface().getSighash('executeUserOp')

  before(async function () {
    this.timeout(200000)
    c = new PreVgChecker()
    await c.init()
    console.log('client ver=', await ethers.provider.send('web3_clientVersion', []))
  })
  beforeEach(function () {
    c.statsDict.reset()
  })
  afterEach(function () {
    console.log(this.currentTest?.title)
    c.statsDict.dump()
  })

  it('should check bundle sizes', async function () {
    this.timeout(200000)
    for (let bundleSize = 1; bundleSize <= 40; bundleSize += 5) {
      await c.checkPreVg({ bundleSize, callDataSize: 1000 })
    }
  })
  it('should check small calldataSize', async () => {
    for (let n = 1; n <= 500; n += 15) {
      await c.checkPreVg({ bundleSize: 1, callDataSize: n })
    }
  })
  it('should check calldataSize', async () => {
    for (let n = 1; n <= 2000; n += 150) {
      await c.checkPreVg({ bundleSize: 1, callDataSize: n })
    }
  })
  it('should check initDataSize', async function () {
    this.timeout(200000)
    for (let n = 0; n <= 2000; n += 15) {
      await c.checkPreVg({ bundleSize: 1, useFactory: true, factoryAppendSize: n * 8 })
    }
  })
  it('should check pmDataSize', async () => {
    for (let n = 1; n <= 2000; n += 150) {
      await c.checkPreVg({ bundleSize: 1, pmDataSize: n * 8 })
    }
  })
  it('should check sigSize', async () => {
    for (let n = 1; n <= 2000; n += 150) {
      await c.checkPreVg({ bundleSize: 1, sigSize: n * 8 })
    }
  })
  it('should check executeUserOp', async () => {
    for (let n = 1; n <= 10000; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: false, callDataSize: n, callDataPrefix: executeUserOpSig })
    }
  })
})
