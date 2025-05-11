import { PreVerificationGasCalculator } from '../src'
import {
  deployEntryPoint,
  IEntryPoint, packUserOp, rethrowWithRevertReason,
  UserOperation,
  DummyAccountFactory__factory, DummyPaymaster__factory,
  DummyAccountFactory,
  DummyPaymaster, IAccountExecute__factory
} from '@account-abstraction/utils'
import { ethers } from 'hardhat'
import {
  UserOperationEventEventObject
} from '@account-abstraction/utils/dist/src/types/@account-abstraction/contracts/interfaces/IEntryPoint'
import { hexConcat, parseEther } from 'ethers/lib/utils'

const provider = ethers.provider
const signer = provider.getSigner()

const calcConfig = {
  transactionGasStipend: 21000,
  fixedGasOverhead: 30815,
  perUserOpGasOverhead: 7065,
  perUserOpWordGasOverhead: 9.5,
  zeroByteGasCost: 4,
  nonZeroByteGasCost: 16,
  estimationSignatureSize: 65,
  estimationPaymasterDataSize: 0
}
const defaultUserOpFields = {
  callData: '0x',
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

  // for stats:
  private maxDiff?: number
  private minDiff?: number
  private totDiff?: number
  private totCount?: number

  constructor () {
    this.resetStats()
  }

  resetStats (): void {
    this.maxDiff = undefined
    this.minDiff = undefined
    this.totDiff = undefined
    this.totCount = undefined
  }

  dumpStats (): void {
    const avg = Math.round(this.totDiff! / this.totCount!)
    console.log(`stats: ${this.minDiff}/${avg}/${this.maxDiff}`)
    this.resetStats()
  }

  async init (): Promise<void> {
    this.entryPoint = await deployEntryPoint(provider)

    // separate factories for accounts, to avoid warming up...
    this.factories = await Promise.all(Array.from({ length: 50 },
      async () => await new DummyAccountFactory__factory(signer).deploy(this.entryPoint.address)
    ))
    this.paymasters = await Promise.all(Array.from({ length: 50 },
      async () => await new DummyPaymaster__factory(signer).deploy(this.entryPoint.address)
    ))
    // fund all paymasters:
    await Promise.all(this.paymasters.map(async pm =>
      await this.entryPoint.depositTo(pm.address, { value: parseEther('1') })
    ))

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
        verificationGasLimit: 5100000,
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
    let minEvGasUsed = Number.MAX_SAFE_INTEGER
    let MaxEvGasUsed = 0
    ret.events?.filter(e => e.event === 'UserOperationEvent').forEach((e, i) => {
      const ev = e.args as unknown as UserOperationEventEventObject
      // console.log(`size ${ops.length}  ev.gasused=${ev.actualGasUsed.toNumber()}, ${JSON.stringify(ops[i])}`)
      if (ev.actualGasUsed.toNumber() < minEvGasUsed) {
        minEvGasUsed = ev.actualGasUsed.toNumber()
      }
      if (ev.actualGasUsed.toNumber() > MaxEvGasUsed) {
        MaxEvGasUsed = ev.actualGasUsed.toNumber()
      }
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
    const calc = new PreVerificationGasCalculator({
      ...calcConfig,
      expectedBundleSize: p1.bundleSize
    })
    const calcPreVg = calc._calculate(ops[0])
    const diff = calcPreVg - ret
    if (this.maxDiff == null || diff > this.maxDiff) {
      this.maxDiff = diff
    }
    if (this.minDiff == null || diff < this.minDiff) {
      this.minDiff = diff
    }
    this.totDiff = (this.totDiff ?? 0) + diff
    this.totCount = (this.totCount ?? 0) + 1
    console.log(`check ${JSON.stringify(p)} = overhead=${ret}  calc=${calcPreVg} diff=${diff}`)
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
  })
  beforeEach(function () {
    c.resetStats()
  })
  afterEach(function () {
    console.log(this.currentTest?.title)
    c.dumpStats()
  })

  it('should check bundle sizes', async () => {
    for (let bundleSize = 1; bundleSize <= 10; bundleSize++) {
      await c.checkPreVg({ bundleSize, callDataSize: 0 })
    }
  })
  it('should check calldataSize', async () => {
    for (let n = 0; n <= 100; n += 5) {
      await c.checkPreVg({ bundleSize: 1, callDataSize: n })
    }
  })
  it('should check pmDataSize', async () => {
    for (let n = 52; n <= 1000; n += 2) {
      await c.checkPreVg({ bundleSize: 1, pmDataSize: n })
    }
  })
  it('should check sigSize', async () => {
    for (let n = 1; n <= 100; n += 5) {
      await c.checkPreVg({ bundleSize: 1, sigSize: n })
    }
  })
  it('should check executeUserOp', async () => {
    for (let n = 1; n <= 10000; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: false, callDataSize: n, callDataPrefix: executeUserOpSig })
    }
  })
})
