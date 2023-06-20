import { EntryPoint, EntryPoint__factory, UserOperation } from '@account-abstraction/utils/src/ContractTypes'
import {
  AbiCoder,
  BigNumberish,
  BytesLike,
  concat,
  hexlify, isBytesLike, JsonRpcProvider,
  keccak256,
  parseEther, Provider,
  Signer,
  toBeHex, zeroPadValue
} from 'ethers'
import { expect } from 'chai'
import {
  TestOpcodesAccount,
  TestOpcodesAccount__factory,
  TestOpcodesAccountFactory,
  TestOpcodesAccountFactory__factory,
  TestRulesAccount,
  TestRulesAccount__factory,
  TestRulesAccountFactory__factory,
  TestStorageAccount__factory,
  TestStorageAccountFactory,
  TestStorageAccountFactory__factory,
  TestStorageAccount,
  TestCoin,
  TestCoin__factory
} from '../src/types'
import { ValidateUserOpResult, ValidationManager } from '../src/modules/ValidationManager'
import { ReputationManager } from '../src/modules/ReputationManager'
import { AddressZero, decodeErrorReason, toLowerAddr } from '@account-abstraction/utils'
import { isGeth } from '../src/utils'
import { TestRecursionAccount__factory } from '../src/types/factories/contracts/tests/TestRecursionAccount__factory'
import { provider } from './testUtils'

const defaultAbiCoder = AbiCoder.defaultAbiCoder()

const cEmptyUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  paymasterAndData: '0x',
  signature: '0x',
  initCode: '0x',
  callData: '0x',
  callGasLimit: 0,
  verificationGasLimit: 50000,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 0,
  preVerificationGas: 0
}

function toBytes32 (value: BigNumberish | BytesLike): string {
  if (isBytesLike(value)) {
    return zeroPadValue(value, 32)
  } else {
    return toBeHex(value, 32)
  }
}

describe('#ValidationManager', () => {
  let vm: ValidationManager
  let opcodeFactory: TestOpcodesAccountFactory
  let storageFactory: TestStorageAccountFactory
  let testcoin: TestCoin

  let paymaster: TestOpcodesAccount
  let entryPoint: EntryPoint
  let rulesAccount: TestRulesAccount
  let storageAccount: TestStorageAccount

  async function testUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress?: string): Promise<ValidateUserOpResult & { userOp: UserOperation }> {
    const userOp = await createTestUserOp(validateRule, pmRule, initFunc, factoryAddress ?? await opcodeFactory.getAddress())
    return { userOp, ...await vm.validateUserOp(userOp) }
  }

  async function testExistingUserOp (validateRule: string = '', pmRule = ''): Promise<ValidateUserOpResult & { userOp: UserOperation }> {
    const userOp = await existingStorageAccountUserOp(validateRule, pmRule)
    return { userOp, ...await vm.validateUserOp(userOp) }
  }

  async function existingStorageAccountUserOp (validateRule = '', pmRule = ''): Promise<UserOperation> {
    const paymasterAndData = pmRule === '' ? '0x' : concat([await paymaster.getAddress(), Buffer.from(pmRule)])
    const signature = hexlify(Buffer.from(validateRule))
    return {
      ...cEmptyUserOp,
      sender: await storageAccount.getAddress(),
      signature,
      paymasterAndData,
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000
    }
  }

  async function createTestUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress?: string): Promise<UserOperation> {
    if (initFunc === undefined) {
      initFunc = opcodeFactory.interface.encodeFunctionData('create', [''])
    }

    const initCode = concat([
      factoryAddress ?? await opcodeFactory.getAddress(),
      initFunc
    ])
    const paymasterAndData = pmRule == null ? '0x' : concat([await paymaster.getAddress(), Buffer.from(pmRule)])
    const signature = hexlify(Buffer.from(validateRule))
    const callinitCodeForAddr = await provider.call({
      to: factoryAddress,
      data: initFunc
    })
    // todo: why "call" above doesn't throw on error ?!?!
    if (decodeErrorReason(callinitCodeForAddr)?.message != null) {
      throw new Error(decodeErrorReason(callinitCodeForAddr)?.message)
    }
    const [sender] = defaultAbiCoder.decode(['address'], callinitCodeForAddr)
    return {
      ...cEmptyUserOp,
      sender,
      initCode,
      signature,
      paymasterAndData,
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000
    }
  }

  let ethersSigner: Signer

  before(async function () {
    ethersSigner = await provider.getSigner()
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    paymaster = await new TestOpcodesAccount__factory(ethersSigner).deploy()
    await entryPoint.depositTo(await paymaster.getAddress(), { value: parseEther('0.1') })
    await paymaster.addStake(await entryPoint.getAddress(), { value: parseEther('0.1') })
    opcodeFactory = await new TestOpcodesAccountFactory__factory(ethersSigner).deploy()
    testcoin = await new TestCoin__factory(ethersSigner).deploy()
    storageFactory = await new TestStorageAccountFactory__factory(ethersSigner).deploy(await testcoin.getAddress())

    storageAccount = TestStorageAccount__factory.connect(await storageFactory.create.staticCall(1, ''), provider)
    await storageFactory.create(1, '')

    const rulesFactory = await new TestRulesAccountFactory__factory(ethersSigner).deploy()
    rulesAccount = TestRulesAccount__factory.connect(await rulesFactory.create.staticCall(''), provider)
    await rulesFactory.create('')
    await entryPoint.depositTo(await rulesAccount.getAddress(), { value: parseEther('1') })

    const reputationManager = new ReputationManager({
      minInclusionDenominator: 1,
      throttlingSlack: 1,
      banSlack: 1
    },
    parseEther('0'), 0)

    const _isGeth = await isGeth(provider as Provider as JsonRpcProvider)

    if (!_isGeth) {
      console.log('WARNING: opcode banning tests can only run with geth (require debug_traceCall)')
      this.skip()
      return
    }
    vm = new ValidationManager(entryPoint, reputationManager, false)
  })

  it('#getCodeHashes', async () => {
    const epHash = keccak256(await provider.getCode(await entryPoint.getAddress()))
    const pmHash = keccak256(await provider.getCode(await paymaster.getAddress()))
    const addresses = [await entryPoint.getAddress(), await paymaster.getAddress()]
    const packed = defaultAbiCoder.encode(['bytes32[]'], [[epHash, pmHash]])
    const packedHash = keccak256(packed)
    expect(await vm.getCodeHashes(addresses)).to.eql({
      addresses,
      hash: packedHash
    })
  })

  it('should accept plain request', async () => {
    await testUserOp()
  })
  it('test sanity: reject unknown rule', async () => {
    expect(await testUserOp('<unknown-rule>')
      .catch(e => e.message)).to.match(/unknown rule/)
  })
  it('should fail with bad opcode in ctr', async () => {
    expect(
      await testUserOp('', undefined, opcodeFactory.interface.encodeFunctionData('create', ['coinbase']))
        .catch(e => e.message)).to.match(/factory uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in paymaster', async () => {
    expect(await testUserOp('', 'coinbase', undefined)
      .catch(e => e.message)).to.match(/paymaster uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in validation', async () => {
    expect(await testUserOp('blockhash')
      .catch(e => e.message)).to.match(/account uses banned opcode: BLOCKHASH/)
  })
  it('should fail if creating too many', async () => {
    expect(await testUserOp('create2')
      .catch(e => e.message)).to.match(/account uses banned opcode: CREATE2/)
  })
  // TODO: add a test with existing wallet, which should succeed (there is one in the "bundler spec"
  it('should fail referencing self token balance (during wallet creation)', async () => {
    expect(await testUserOp('balance-self', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), await storageFactory.getAddress())
      .catch(e => e)
    ).to.match(/unstaked account accessed/)
  })

  it('account succeeds referencing its own balance (after wallet creation)', async () => {
    await testExistingUserOp('balance-self')
  })

  describe('access allowance (existing wallet)', () => {
    it('account fails to read allowance of other address (even if account is token owner)', async () => {
      expect(await testExistingUserOp('allowance-self-1')
        .catch(e => e.message))
        .to.match(/account has forbidden read/)
    })
    it('account can reference its own allowance on other contract balance', async () => {
      await testExistingUserOp('allowance-1-self')
    })
  })

  describe('access struct (existing wallet)', () => {
    it('should access self struct data', async () => {
      await testExistingUserOp('struct-self')
    })
    it('should fail to access other address struct data', async () => {
      expect(await testExistingUserOp('struct-1')
        .catch(e => e.message)
      ).match(/account has forbidden read/)
    })
  })

  describe('validate storageMap', () => {
    // let names: { [name: string]: string }
    before(async () => {
      // names = {
      //   pm: await paymaster.getAddress(),
      //   ep: await entryPoint.getAddress(),
      //   opf: await opcodeFactory.getAddress(),
      //   stf: await storageFactory.getAddress(),
      //   acc: rulesAccount.address,
      //   tok: await rulesAccount.coin()
      // }
    })

    it('should return nothing during account creation', async () => {
      const ret = await testUserOp('read-self', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), await storageFactory.getAddress())
      // console.log('resolved=', resolveNames(ret, names, true))
      expect(ret.storageMap[await toLowerAddr(ret.userOp.sender)]).to.eql({
        [toBytes32(1)]: toBytes32(0)
      })
    })

    it('should return self storage on existing account', async () => {
      const ret = await testExistingUserOp('read-self')
      // console.log('resolved=', resolveNames(ret, names, true))
      const account = await toLowerAddr(ret.userOp.sender)
      expect(ret.storageMap[account]).to.eql({
        [toBytes32(1)]: zeroPadValue(await testcoin.getAddress(), 32)
      })
    })

    it('should return nothing with no storage access', async () => {
      const ret = await testExistingUserOp('')
      expect(ret.storageMap).to.eql({})
    })

    it('should return referenced storage', async () => {
      const ret = await testExistingUserOp('balance-self')
      // console.log('resolved=', resolveNames(ret, names, true))

      const account = await toLowerAddr(ret.userOp.sender)

      // account's token at slot 1 of account
      expect(ret.storageMap[account]).to.eql({
        [toBytes32(1)]: toBytes32(await testcoin.getAddress())
      })
      // token.balances[account] - balances uses slot 0 of token
      const hashRef = keccak256(concat([toBytes32(account), toBytes32(0)]))
      expect(ret.storageMap[(await testcoin.getAddress()).toLowerCase()]).to.eql({
        [hashRef]: toBytes32(0)
      })
    })
  })

  it('should fail if referencing other token balance', async () => {
    expect(await testUserOp('balance-1', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), await storageFactory.getAddress())
      .catch(e => e.message))
      .to.match(/account has forbidden read/)
  })

  it('should succeed referencing self token balance after wallet creation', async () => {
    await testExistingUserOp('balance-self', undefined)
  })

  it('should fail with unstaked paymaster returning context', async () => {
    const pm = await new TestStorageAccount__factory(ethersSigner).deploy()
    // await entryPoint.depositTo(pm.address, { value: parseEther('0.1') })
    // await pm.addStake(await entryPoint.getAddress(), { value: parseEther('0.1') })
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(await entryPoint.getAddress())

    const userOp = {
      ...cEmptyUserOp,
      sender: await acct.getAddress(),
      paymasterAndData: concat([
        await pm.getAddress(),
        Buffer.from('postOp-context')
      ])
    }
    expect(await vm.validateUserOp(userOp)
      .then(() => 'should fail', e => e.message))
      .to.match(/unstaked paymaster must not return context/)
  })

  it('should fail if validation recursively calls handleOps', async () => {
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(await entryPoint.getAddress())
    const op: UserOperation = {
      ...cEmptyUserOp,
      sender: await acct.getAddress(),
      signature: hexlify(Buffer.from('handleOps')),
      preVerificationGas: 50000
    }
    expect(
      await vm.validateUserOp(op)
        .catch(e => e.message)
    ).to.match(/illegal call into EntryPoint/)
  })
  it('should succeed with inner revert', async () => {
    expect(await testUserOp('inner-revert', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), await storageFactory.getAddress()))
  })
  it('should fail with inner oog revert', async () => {
    expect(await testUserOp('oog', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), await storageFactory.getAddress())
      .catch(e => e.message)
    ).to.match(/account internally reverts on oog/)
  })
})
