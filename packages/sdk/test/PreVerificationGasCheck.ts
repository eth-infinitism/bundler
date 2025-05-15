import {
  AddressZero,
  deployEntryPoint,
  DummyAccountFactory,
  DummyAccountFactory__factory,
  DummyPaymaster,
  DummyPaymaster__factory,
  IAccountExecute__factory,
  IEntryPoint,
  packUserOp,
  rethrowWithRevertReason,
  UserOperation
} from '@account-abstraction/utils'
import {
  GasOptions,
  PreVerificationGasCalculator,
  PreVerificationGasCalculatorConfig
} from '../src/PreVerificationGasCalculator'
import { hexConcat, parseEther } from 'ethers/lib/utils'
import {
  UserOperationEventEventObject
} from '@account-abstraction/utils/dist/src/types/@account-abstraction/contracts/interfaces/IEntryPoint'
import Debug from 'debug'
import { JsonRpcProvider } from '@ethersproject/providers'
import { StatsDict } from './StatsDict'

const debug = Debug('aa.test.prevg')

const MAX_BUNDLE_SIZE = 40

export const EXECUTE_USEROP_METHOD_SIG = IAccountExecute__factory.createInterface().getSighash('executeUserOp')

export interface BundleParams {
  bundleSize: number
  callDataSize: number
  useFactory: boolean
  factoryAppendSize?: number
  sigSize: number
  pmDataSize?: number
  callDataPrefix?: string // stub to inject "executeUserOp" callData
}

const calcConfig: Omit<PreVerificationGasCalculatorConfig, 'expectedBundleSize'> = {
  transactionGasStipend: 21000,
  fixedGasOverhead: 9830,
  perUserOpGasOverhead: 7263,
  perUserOpWordGasOverhead: 9.5,
  executeUserOpPerWordGasOverhead: 18,
  executeUserOpGasOverhead: 1440,
  standardTokenGasCost: 4,
  useEip7623: true,
  floorPerTokenGasCost: 10,
  tokensPerNonzeroByte: 4,
  eip7702AuthGas: 25000,
  estimationSignatureSize: 65,
  estimationPaymasterDataSize: 0
}

const defaultUserOpFields = {
  callData: '0x01',
  callGasLimit: 1000,
  nonce: 0,
  preVerificationGas: 0,
  verificationGasLimit: 1000000,
  maxFeePerGas: 1e7,
  maxPriorityFeePerGas: 1e7,
  signature: '0x'.padEnd(65 * 2, 'f')
}

const defaultBundleParams: BundleParams = {
  bundleSize: 1,
  callDataSize: 0,
  useFactory: false,
  sigSize: 64,
  pmDataSize: undefined
}

export class PreVerificationGasCheck {
  private salt = 0
  private readonly factories: DummyAccountFactory[] = []
  private readonly paymasters: DummyPaymaster[] = []
  private beneficiary?: string

  // @ts-ignore
  private entryPoint: IEntryPoint

  statsDict = new StatsDict()

  constructor (
    private readonly provider: JsonRpcProvider,
    readonly gasOptions: GasOptions) {
  }

  async init (): Promise<void> {
    const signer = this.provider.getSigner()
    // solves "transaction in progress" on clean geth..
    await signer.sendTransaction({ to: AddressZero })
    this.entryPoint = await deployEntryPoint(this.provider)

    for (let i = 0; i < MAX_BUNDLE_SIZE; i++) {
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
        await this.entryPoint.handleOps([packUserOp(op1)], this.beneficiary!)
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
        callGasLimit: 1000,
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

  // send a bundle.
  // return the actual preVerificationGas: the diff between actual used gas and gas paid by UserOperations
  // (as reported in UserOperationEvent)
  // NOTE: doesn't calculate the preVG of each UserOperation in the bundle separately, but the average of them all
  // (since we can't tell the actual gas used of each UserOperation, only of the entire bundle)
  async sendBundle (ops: UserOperation[]): Promise<number> {
    const packed = ops.map(packUserOp)
    const ret = await this.entryPoint.handleOps(packed, this.beneficiary!)
      .then(async tx => await tx.wait())
      .catch(rethrowWithRevertReason)
    let evTotalGasUsed = 0
    ret.events?.filter(e => e.event === 'UserOperationEvent').forEach(e => {
      const ev = e.args as unknown as UserOperationEventEventObject
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
    const actualPreVG = await this.sendBundle(ops)
    const calc = new PreVerificationGasCalculator({
      ...calcConfig,
      expectedBundleSize: p1.bundleSize
    })
    const calcPreVg = calc._calculate(ops[0], this.gasOptions)
    const diff = calcPreVg - actualPreVG
    this.statsDict.add({ ...p1, diff })
    debug(`check ${JSON.stringify(p)} = overhead=${actualPreVG}  calc=${calcPreVg} diff=${diff}`)
    return actualPreVG
  }
}
