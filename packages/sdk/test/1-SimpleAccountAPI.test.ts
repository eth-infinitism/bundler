import {
  EntryPoint,
  EntryPoint__factory,
  SimpleAccountFactory__factory,
  SampleRecipient, SampleRecipient__factory,
  UserOperationStruct
} from '@account-abstraction/utils/dist/src/ContractTypes'
import { HDNodeWallet, parseEther, Signer, Wallet } from 'ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { ethers } from 'hardhat'
import { DeterministicDeployer, SimpleAccountAPI } from '../src'
import { AddressZero, rethrowError } from '@account-abstraction/utils'
import { expect } from 'chai'

const provider = ethers.provider

describe('SimpleAccountAPI', () => {
  let owner: HDNodeWallet
  let api: SimpleAccountAPI
  let entryPoint: EntryPoint
  let beneficiary: string
  let recipient: SampleRecipient
  let accountAddress: string
  let accountDeployed = false
  let signer: Signer
  let entryPointAddress: string

  before('init', async () => {
    signer =  await provider.getSigner()
    entryPoint = await new EntryPoint__factory(await signer).deploy()
    beneficiary = await signer.getAddress()

    recipient = await new SampleRecipient__factory(signer).deploy()
    owner = Wallet.createRandom()
    DeterministicDeployer.init(ethers.provider)
    entryPointAddress = await entryPoint.getAddress()
    const factoryAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [entryPointAddress])
    api = new SimpleAccountAPI({
      provider,
      entryPointAddress,
      owner,
      factoryAddress
    })
  })

  it('#getUserOpHash should match entryPoint.getUserOpHash', async function () {
    const userOp: UserOperationStruct = {
      sender: '0x'.padEnd(42, '1'),
      nonce: 2,
      initCode: '0x3333',
      callData: '0x4444',
      callGasLimit: 5,
      verificationGasLimit: 6,
      preVerificationGas: 7,
      maxFeePerGas: 8,
      maxPriorityFeePerGas: 9,
      paymasterAndData: '0xaaaaaa',
      signature: '0xbbbb'
    }
    const hash = await api.getUserOpHash(userOp)
    const epHash = await entryPoint.getUserOpHash(userOp)
    expect(hash).to.equal(epHash)
  })

  it('should deploy to counterfactual address', async () => {
    accountAddress = await api.getAccountAddress()
    expect(await provider.getCode(accountAddress).then(code => code.length)).to.equal(2)

    await signer.sendTransaction({
      to: accountAddress,
      value: parseEther('0.1')
    })
    const op = await api.createSignedUserOp({
      target: await recipient.getAddress(),
      data: recipient.interface.encodeFunctionData('something', ['hello'])
    })

    await expect(entryPoint.handleOps([op], beneficiary)).to.emit(recipient, 'Sender')
      .withArgs(anyValue, accountAddress, 'hello')
    expect(await provider.getCode(accountAddress).then(code => code.length)).to.greaterThan(1000)
    accountDeployed = true
  })

  context('#rethrowError', () => {
    let userOp: UserOperationStruct
    before(async () => {
      userOp = await api.createUnsignedUserOp({
        target: AddressZero,
        data: '0x'
      })
      // expect FailedOp "invalid signature length"
      userOp.signature = '0x11'
    })
    it('should parse FailedOp error', async () => {
      await expect(
        entryPoint.handleOps([userOp], beneficiary)
          .catch(rethrowError))
        .to.revertedWith('FailedOp: AA23 reverted: ECDSA: invalid signature length')
    })
    it('should parse Error(message) error', async () => {
      await expect(
        entryPoint.addStake(0)
      ).to.revertedWith('must specify unstake delay')
    })
    it('should parse revert with no description', async () => {
      // use wrong signature for contract..
      const wrongContract = EntryPoint__factory.connect(await recipient.getAddress(), provider)
      await expect(
        wrongContract.addStake(0)
      ).to.revertedWithoutReason()
    })
  })

  it('should use account API after creation without a factory', async function () {
    if (!accountDeployed) {
      this.skip()
    }
    const api1 = new SimpleAccountAPI({
      provider,
      entryPointAddress,
      accountAddress,
      owner
    })
    const op1 = await api1.createSignedUserOp({
      target: await recipient.getAddress(),
      data: recipient.interface.encodeFunctionData('something', ['world'])
    })
    await expect(entryPoint.handleOps([op1], beneficiary)).to.emit(recipient, 'Sender')
      .withArgs(anyValue, accountAddress, 'world')
  })
})
