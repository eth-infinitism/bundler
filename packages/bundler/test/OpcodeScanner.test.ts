import { EntryPoint, EntryPoint__factory, UserOperationStruct } from '@account-abstraction/contracts'
import { hexConcat, hexlify } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestCoin, TestCoin__factory, TestRulesAccountDeployer, TestRulesAccountDeployer__factory } from '../src/types'
import { isGeth, opcodeScanner } from '../src/opcodeScanner'

describe('opcode banning', () => {
  let deployer: TestRulesAccountDeployer
  let entryPoint: EntryPoint
  let token: TestCoin

  async function testUserOp(validateRule: string = '', initFunc?: string) {
    return await opcodeScanner(await createTestUserOp(validateRule, initFunc), entryPoint)
  }

  async function createTestUserOp (validateRule: string = '', initFunc?: string): Promise<UserOperationStruct> {
    if (initFunc == undefined) {
      initFunc = deployer.interface.encodeFunctionData('create', ['', token.address])
    }

    const initCode = hexConcat([
      deployer.address,
      initFunc
    ])
    let signature: string
    if (validateRule.startsWith('deadline:')) {
      signature = hexlify(validateRule.slice(9))
    } else {
      signature = hexlify(Buffer.from(validateRule))
    }
    const sender = await deployer.callStatic.create('', token.address)
    return {
      sender,
      initCode,
      signature,
      nonce: 0,
      callData: '0x',
      paymasterAndData: '0x',
      callGasLimit: 1e6,
      verificationGasLimit: 1e5,
      preVerificationGas: 50000,
      maxFeePerGas: 0,
      maxPriorityFeePerGas: 0
    }
  }

  before(async function () {
    let ethersSigner = ethers.provider.getSigner()
    deployer = await new TestRulesAccountDeployer__factory(ethersSigner).deploy()
    token = await new TestCoin__factory(ethersSigner).deploy()
    entryPoint = await new EntryPoint__factory(ethersSigner).deploy()

    if (!await isGeth(ethers.provider)) {
      console.log('opcode banning tests can only run with geth')
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
    expect(await testUserOp('',
      deployer.interface.encodeFunctionData('create', ['coinbase', token.address]))
      .catch(e => e.message)).to.match(/account uses banned opcode: COINBASE/)
  })
  it('should fail with bad opcode in validation', async () => {
    expect(await testUserOp('blockhash')
      .catch(e => e.message)).to.match(/account uses banned opcode: BLOCKHASH/)
  })
  it('should fail if creating too many', async () => {
    expect(await testUserOp('create2')
      .catch(e => e.message)).to.match(/initCode with too many CREATE2/)
  })
  it('should succeed if referencing self token balance', async () => {
    await testUserOp('balance-self')
  })
  it('should fail if referencing other token balance', async () => {

    expect(await testUserOp('balance-1').catch(e=>e)).to.match(/forbidden read/)
  })
})
