import { assert, expect } from 'chai'
import { defaultAbiCoder, hexConcat, hexlify, keccak256, parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'

import {
  AddressZero,
  decodeErrorReason, deployEntryPoint,
  IEntryPoint,
  toBytes32,
  UserOperation
} from '@account-abstraction/utils'
import {
  ValidateUserOpResult,
  ValidationManager,
  checkRulesViolations,
  supportsDebugTraceCall
} from '@account-abstraction/validation-manager'
import { PreVerificationGasCalculator, MainnetConfig } from '@account-abstraction/sdk'

import {
  TestCoin,
  TestCoin__factory,
  TestOpcodesAccount,
  TestOpcodesAccountFactory,
  TestOpcodesAccountFactory__factory,
  TestOpcodesAccount__factory,
  TestRecursionAccount__factory,
  TestRulesAccount,
  TestRulesAccountFactory__factory,
  TestRulesAccount__factory,
  TestStorageAccount,
  TestStorageAccountFactory,
  TestStorageAccountFactory__factory,
  TestStorageAccount__factory,
  TestTimeRangeAccountFactory,
  TestTimeRangeAccountFactory__factory
} from '../src/types'
import { ERC7562Parser } from '@account-abstraction/validation-manager/dist/src/ERC7562Parser'

const cEmptyUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  signature: '0x',
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
  let testcoin: TestCoin

  let paymaster: TestOpcodesAccount
  let entryPoint: IEntryPoint
  let rulesAccount: TestRulesAccount
  let storageAccount: TestStorageAccount

  async function testUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress = opcodeFactory.address): Promise<ValidateUserOpResult & {
    userOp: UserOperation
  }> {
    const userOp = await createTestUserOp(validateRule, pmRule, initFunc, factoryAddress)
    return { userOp, ...await vm.validateUserOp(userOp) }
  }

  async function testExistingUserOp (validateRule: string = '', pmRule = ''): Promise<ValidateUserOpResult & {
    userOp: UserOperation
  }> {
    const userOp = await existingStorageAccountUserOp(validateRule, pmRule)
    return { userOp, ...await vm.validateUserOp(userOp) }
  }

  async function existingStorageAccountUserOp (validateRule = '', pmRule = ''): Promise<UserOperation> {
    const pmd = pmRule === ''
      ? {}
      : {
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 1e5,
          paymasterPostOpGasLimit: 1e5,
          paymasterData: Buffer.from(pmRule)
        }
    const signature = hexlify(Buffer.from(validateRule))
    return {
      ...cEmptyUserOp,
      sender: storageAccount.address,
      signature,
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000,
      // @ts-ignore
      pmd
    }
  }

  async function createTestUserOp (validateRule: string = '', pmRule?: string, initFunc?: string, factoryAddress = opcodeFactory.address): Promise<UserOperation> {
    if (initFunc === undefined) {
      initFunc = opcodeFactory.interface.encodeFunctionData('create', [''])
    }

    const pmInfo = pmRule == null
      ? {}
      : {
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 1e6,
          paymasterPostOpGasLimit: 1e6,
          paymasterData: Buffer.from(pmRule)
        }
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
    const op: UserOperation = {
      ...cEmptyUserOp,
      sender,
      signature,
      callGasLimit: 1e6,
      verificationGasLimit: 1e6,
      preVerificationGas: 50000,
      factory: factoryAddress,
      factoryData: initFunc,
      ...pmInfo
    }
    return op
  }

  const provider = ethers.provider
  const ethersSigner = provider.getSigner()

  before(async function () {
    entryPoint = await deployEntryPoint(provider)
    paymaster = await new TestOpcodesAccount__factory(ethersSigner).deploy()
    await entryPoint.depositTo(paymaster.address, { value: parseEther('0.1') })
    await paymaster.addStake(entryPoint.address, { value: parseEther('0.1') })
    opcodeFactory = await new TestOpcodesAccountFactory__factory(ethersSigner).deploy()
    testcoin = await new TestCoin__factory(ethersSigner).deploy()
    storageFactory = await new TestStorageAccountFactory__factory(ethersSigner).deploy(testcoin.address)

    storageAccount = TestStorageAccount__factory.connect(await storageFactory.callStatic.create(1, ''), provider)
    await storageFactory.create(1, '')

    const rulesFactory = await new TestRulesAccountFactory__factory(ethersSigner).deploy()
    rulesAccount = TestRulesAccount__factory.connect(await rulesFactory.callStatic.create(''), provider)
    await rulesFactory.create('')
    await entryPoint.depositTo(rulesAccount.address, { value: parseEther('1') })

    const unsafe = !await supportsDebugTraceCall(provider, false)
    const preVerificationGasCalculator = new PreVerificationGasCalculator(MainnetConfig)

    const senderCreator = await entryPoint.senderCreator()
    const erc7562Parser = new ERC7562Parser(entryPoint.address, senderCreator)
    vm = new ValidationManager(entryPoint, unsafe, preVerificationGasCalculator, erc7562Parser)

    if (!await supportsDebugTraceCall(ethers.provider, false)) {
      console.log('WARNING: opcode banning tests can only run with geth')
      this.skip()
    }
  })

  it('#getCodeHashes', async () => {
    const epHash = keccak256(await provider.getCode(entryPoint.address))
    const pmHash = keccak256(await provider.getCode(paymaster.address))
    const addresses = [entryPoint.address, paymaster.address]
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
    expect(await testUserOp('balance-self', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
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
        .to.match(/unstaked account accessed/)
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
      ).match(/unstaked account accessed/)
    })
  })

  describe('time-range', () => {
    let testTimeRangeAccountFactory: TestTimeRangeAccountFactory

    // note: parameters are "js time", not "unix time"
    async function testTimeRangeUserOp (validAfterMs: number, validUntilMs: number): Promise<void> {
      const userOp = await createTestUserOp('', undefined, undefined, testTimeRangeAccountFactory.address)
      userOp.preVerificationGas = Math.floor(validAfterMs / 1000)
      userOp.maxPriorityFeePerGas = Math.floor(validUntilMs / 1000)
      await vm.validateUserOp(userOp)
    }

    before(async () => {
      testTimeRangeAccountFactory = await new TestTimeRangeAccountFactory__factory(ethersSigner).deploy()
    })

    it('should accept request with future validUntil', async () => {
      await testTimeRangeUserOp(0, Date.now() + 60000)
    })
    it('should accept request with past validAfter', async () => {
      await testTimeRangeUserOp(10000, 0)
    })
    it('should accept request with valid range validAfter..validTo', async () => {
      await testTimeRangeUserOp(10000, Date.now() + 60000)
    })

    it('should reject request with past validUntil', async () => {
      expect(
        await testTimeRangeUserOp(0, Date.now() - 1000).catch(e => e.message)
      ).match(/expired/)
    })

    it('should reject request with short validUntil', async () => {
      expect(
        await testTimeRangeUserOp(0, Date.now() + 25000).catch(e => e.message)
      ).to.match(/expires too soon/)
    })

    it('should reject request with future validAfter', async () => {
      expect(
        await testTimeRangeUserOp(Date.now() * 2, 0).catch(e => e.message)
      ).to.match(/not due/)
    })
  })

  describe('validate storageMap', () => {
    // let names: { [name: string]: string }
    before(async () => {
      // names = {
      //   pm: paymaster.address,
      //   ep: entryPoint.address,
      //   opf: opcodeFactory.address,
      //   stf: storageFactory.address,
      //   acc: rulesAccount.address,
      //   tok: await rulesAccount.coin()
      // }
    })

    it('should return nothing during account creation', async () => {
      const ret = await testUserOp('read-self', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
      // console.log('resolved=', resolveNames(ret, names, true))
      expect(ret.storageMap[ret.userOp.sender.toLowerCase()]).to.eql({
        [toBytes32(1)]: toBytes32(0)
      })
    })

    it('should return self storage on existing account', async () => {
      const ret = await testExistingUserOp('read-self')
      // console.log('resolved=', resolveNames(ret, names, true))
      const account = ret.userOp.sender.toLowerCase()
      expect(ret.storageMap[account]).to.eql({
        [toBytes32(1)]: toBytes32(testcoin.address)
      })
    })

    it('should return nothing with no storage access', async () => {
      const ret = await testExistingUserOp('')
      expect(ret.storageMap).to.eql({})
    })

    it('should return referenced storage', async () => {
      const ret = await testExistingUserOp('balance-self')
      // console.log('resolved=', resolveNames(ret, names, true))

      const account = ret.userOp.sender.toLowerCase()

      // account's token at slot 1 of account
      expect(ret.storageMap[account]).to.eql({
        [toBytes32(1)]: toBytes32(testcoin.address)
      })
      // token.balances[account] - balances uses slot 0 of token
      const hashRef = keccak256(hexConcat([toBytes32(account), toBytes32(0)]))
      expect(ret.storageMap[testcoin.address.toLowerCase()]).to.eql({
        [hashRef]: toBytes32(0)
      })
    })
  })

  it('should fail if referencing other token balance', async () => {
    expect(await testUserOp('balance-1', undefined, storageFactory.interface.encodeFunctionData('create', [0, '']), storageFactory.address)
      .catch(e => e.message))
      .to.match(/unstaked account accessed/)
  })

  it('should succeed referencing self token balance after wallet creation', async () => {
    await testExistingUserOp('balance-self', undefined)
  })

  it('should accept unstaked paymaster returning context', async () => {
    const pm = await new TestStorageAccount__factory(ethersSigner).deploy()
    // await entryPoint.depositTo(pm.address, { value: parseEther('0.1') })
    // await pm.addStake(entryPoint.address, { value: parseEther('0.1') })
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(entryPoint.address)
    await acct.deployTransaction.wait()

    const userOp: UserOperation = {
      ...cEmptyUserOp,
      sender: acct.address,
      paymaster: pm.address,
      paymasterVerificationGasLimit: 1e6,
      paymasterPostOpGasLimit: 1e6,
      paymasterData: Buffer.from('postOp-context')
    }
    await vm.validateUserOp(userOp)
  })

  it('should fail if validation recursively calls handleOps', async () => {
    const acct = await new TestRecursionAccount__factory(ethersSigner).deploy(entryPoint.address)
    await acct.deployTransaction.wait()
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
      .catch(e => e.message)
    ).to.match(/account internally reverts on oog/)
  })

  describe('ValidationPackage', () => {
    it('should pass for a transaction that does not violate the rules', async () => {
      const userOp = await createTestUserOp()
      const res = await checkRulesViolations(provider, userOp, entryPoint.address)
      assert.equal(res.returnInfo.sigFailed, false)
    })

    it('should throw for a transaction that violates the rules', async () => {
      const userOp = await createTestUserOp('coinbase')
      expect(
        await checkRulesViolations(provider, userOp, entryPoint.address).catch(e => e.message)
      ).to.match(/account uses banned opcode: COINBASE/)
    })
  })
})
