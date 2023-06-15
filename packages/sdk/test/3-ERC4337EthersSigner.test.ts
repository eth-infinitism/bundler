import { ethers } from 'hardhat'
import { ClientConfig, ERC4337EthersProvider, wrapProvider } from '../src'
import {
  SampleRecipient, SampleRecipient__factory,
  EntryPoint, EntryPoint__factory
} from '@account-abstraction/utils/dist/src/ContractTypes'
import { expect } from 'chai'
import { parseEther, Signer, Wallet } from 'ethers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
require("@nomicfoundation/hardhat-chai-matchers");

const provider = ethers.provider

describe('ERC4337EthersSigner, Provider', function () {
  let recipient: SampleRecipient
  let aaProvider: ERC4337EthersProvider
  let entryPoint: EntryPoint
  let signer: Signer
  before('init', async () => {
    signer = await ethers.provider.getSigner()
    const deployRecipient = await new SampleRecipient__factory(signer).deploy()
    entryPoint = await new EntryPoint__factory(signer).deploy()
    const config: ClientConfig = {
      entryPointAddress: await entryPoint.getAddress(),
      bundlerUrl: ''
    }
    const aaOwner = Wallet.createRandom()
    aaProvider = await wrapProvider(provider, config, aaOwner)

    const aasigner = await aaProvider.getSigner()
    console.log('aasigner addr=', await aasigner.getAddress())
    const beneficiary = await signer.getAddress()

    // for testing: bypass sending through a bundler, and send directly to our entrypoint..
    aaProvider.httpRpcClient.sendUserOpToBundler = async (userOp) => {
      try {
        await entryPoint.handleOps([userOp], beneficiary)
      } catch (e: any) {
        // doesn't report error unless called with callStatic
        console.log('userop=', userOp)
        await entryPoint.handleOps.staticCall([userOp], beneficiary).catch((e: any) => {

          //wtf: why it doesn't parse errors anymore?
          if ( e.errorArgs == null ){
            const e1 = entryPoint.interface.parseError(e.data)
            e = { errorName: e1?.name, errorArgs: e1?.args }
          }
          // eslint-disable-next-line
          const message = e.errorArgs != null ? `${e.errorName}(${e.errorArgs.join(',')})` : e.message
          throw new Error(message)
        })
      }
      return ''
    }
    recipient = deployRecipient.connect(await aaProvider.getSigner())
  })

  it('should fail to send before funding', async () => {
    try {
      await recipient.something('hello', { gasLimit: 1e6 })
      throw new Error('should revert')
    } catch (e: any) {
      expect(e.message).to.eq('FailedOp(0,AA21 didn\'t pay prefund)')
    }
  })

  it('should use ERC-4337 Signer and Provider to send the UserOperation to the bundler', async function () {
    this.timeout(10000)
    let accountSigner = await aaProvider.getSigner()
    const accountAddress = await accountSigner.getAddress()
    await signer.sendTransaction({
      to: accountAddress,
      value: parseEther('1')
    }).then(r=>r.wait())
    console.log('account', accountAddress, 'bal=', await provider.getBalance(accountAddress))
    const data = recipient.interface.encodeFunctionData('something', ['hello'])
    const r = await accountSigner.sendTransaction({to:recipient.getAddress(), data})
    console.log('ret=',r)
    const ret = await recipient.something('hello', { gasLimit: 1e6} )
    await expect(ret).to.emit(recipient, 'Sender')
      .withArgs(anyValue, accountAddress, 'hello')
  })

  it('should revert if on-chain userOp execution reverts', async function () {
    // specifying gas, so that estimateGas won't revert..
    const ret = await recipient.reverting({ gasLimit: 10000 })

    try {
      await ret.wait()
      throw new Error('expected to revert')
    } catch (e: any) {
      expect(e.message).to.match(/test revert/)
    }
  })
})
