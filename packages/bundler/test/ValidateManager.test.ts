import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { defaultAbiCoder, hexConcat, hexlify, parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  TestOpcodesAccountFactory__factory,
  TestOpcodesAccountFactory,
  TestOpcodesAccount,
  TestOpcodesAccount__factory,
  TestStorageAccountFactory,
  TestStorageAccountFactory__factory,
  TestStorageAccount__factory,
  TestRulesAccount,
  TestRulesAccount__factory,
  TestRulesAccountFactory__factory
} from '../src/types'
import { ValidationManager } from '../src/modules/ValidationManager'
import { ReputationManager } from '../src/modules/ReputationManager'
import { UserOperation } from '../src/modules/moduleUtils'
import { AddressZero, decodeErrorReason } from '@account-abstraction/utils'
import { isGeth } from '../src/utils'
import { TestRecursionAccount__factory } from '../src/types/factories/contracts/tests/TestRecursionAccount__factory'

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

describe('#ValidationManager', () => {
  let vm: ValidationManager
  let opcodeFactory: TestOpcodesAccountFactory
  let storageFactory: TestStorageAccountFactory

  let paymaster: TestOpcodesAccount
  let entryPoint: EntryPoint
  let storageAccount: TestRulesAccount

  async function testUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress = opcodeFactory.address): Promise<void> {
    await vm.validateUserOp(await createTestUserOp(validateRule, pmRule, initFunc, factoryAddress))
  }

  async function testExistingUserOp (validateRule: string = '', pmRule = ''): Promise<void> {
    await vm.validateUserOp(await existingStorageAccountUserOp(validateRule, pmRule))
  }

  async function existingStorageAccountUserOp (validateRule = '', pmRule = ''): Promise<UserOperation> {
    const paymasterAndData = pmRule === '' ? '0x' : hexConcat([paymaster.address, Buffer.from(pmRule)])
    const signature = hexlify(Buffer.from(validateRule))
    return {
      ...cEmptyUserOp,
      sender: storageAccount.address,
      signature,
      paymasterAndData,
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000
    }
  }

  async function createTestUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress = opcodeFactory.address): Promise<UserOperation> {
    if (initFunc === undefined) {
      initFunc = opcodeFactory.interface.encodeFunctionData('create', [''])
    }

    const initCode = hexConcat([
      factoryAddress,
      initFunc
    ])
    const paymasterAndData = pmRule == null ? '0x' : hexConcat([paymaster.address, Buffer.from(pmRule)])
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

  const provider = ethers.provider
  const ethersSigner = provider.getSigner()

  before(async function () {
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()
    paymaster = await new TestOpcodesAccount__factory(ethersSigner).deploy()
    await entryPoint.depositTo(paymaster.address, { value: parseEther('0.1') })
    await paymaster.addStake(entryPoint.address, { value: parseEther('0.1') })
    opcodeFactory = await new TestOpcodesAccountFactory__factory(ethersSigner).deploy()
    storageFactory = await new TestStorageAccountFactory__factory(ethersSigner).deploy()

    const rulesFactory = await new TestRulesAccountFactory__factory(ethersSigner).deploy()
    storageAccount = TestRulesAccount__factory.connect(await rulesFactory.callStatic.create(''), provider)
    await rulesFactory.create('')
    await entryPoint.depositTo(storageAccount.address, { value: parseEther('1') })

    const reputationManager = new ReputationManager({
      minInclusionDenominator: 1,
      throttlingSlack: 1,
      banSlack: 1
    })
    const unsafe = !await isGeth(provider)
    vm = new ValidationManager(entryPoint, reputationManager, parseEther('0'), 0, unsafe)

    if (!await isGeth(ethers.provider)) {
      console.log('WARNING: opcode banning tests can only run with geth')
      this.skip()
    }
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
    expect(await testUserOp('balance-self', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
      .catch(e => e.message))
      .to.match(/account has forbidden read/)
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

  it('should fail if referencing other token balance', async () => {
    expect(await testUserOp('balance-1', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
      .catch(e => e.message))
      .to.match(/account has forbidden read/)
  })

  it('should succeed referencing self token balance after wallet creation', async () => {
    await testExistingUserOp('balance-self', undefined)
  })

  it('should fail with unstaked paymaster returning context', async () => {
    const pm = await new TestStorageAccount__factory(ethersSigner).deploy()
    // await entryPoint.depositTo(pm.address, { value: parseEther('0.1') })
    // await pm.addStake(entryPoint.address, { value: parseEther('0.1') })
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(entryPoint.address)

    const userOp = {
      ...cEmptyUserOp,
      sender: acct.address,
      paymasterAndData: hexConcat([
        pm.address,
        Buffer.from('postOp-context')
      ])
    }
    expect(await vm.validateUserOp(userOp)
      .then(() => 'should fail', e => e.message))
      .to.match(/unstaked paymaster must not return context/)
  })

  it('should fail if validation recursively calls handleOps', async () => {
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(entryPoint.address)
    const op: UserOperation = {
      ...cEmptyUserOp,
      sender: acct.address,
      signature: hexlify(Buffer.from('handleOps')),
      preVerificationGas: 50000
    }
    expect(
      await vm.validateUserOp(op)
        .catch(e => e.message)
    ).to.match(/illegal call into EntryPoint/)
  })
  it('should succeed with inner revert', async () => {
    expect(await testUserOp('inner-revert', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address))
  })
  it('should fail with inner oog revert', async () => {
    expect(await testUserOp('oog', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
      .catch(e => e.message))
      .to.match(/oog/)
  })
})
