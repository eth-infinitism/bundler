import { DebugMethodHandler } from '../src/DebugMethodHandler'
import { ExecutionManager } from '../src/modules/ExecutionManager'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { BundlerConfig } from '../src/BundlerConfig'
import { isGeth } from '../src/utils'
import { parseEther } from 'ethers/lib/utils'
import { MempoolManager } from '../src/modules/MempoolManager'
import { ValidationManager } from '../src/modules/ValidationManager'
import { BundleManager, SendBundleReturn } from '../src/modules/BundleManager'
import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import { ethers } from 'hardhat'
import { EntryPoint, EntryPoint__factory, SimpleAccountFactory__factory } from '@account-abstraction/contracts'
import { DeterministicDeployer, SimpleAccountAPI } from '@account-abstraction/sdk'
import { BundlerHelper__factory } from '../src/types'
import { Wallet } from 'ethers'
import { resolveHexlify } from '@account-abstraction/utils'
import { expect } from 'chai'

const provider = ethers.provider
const signer = provider.getSigner()
describe('#DebugMethodHandler', () => {
  let debugMethodHandler: DebugMethodHandler
  let entryPoint: EntryPoint
  let methodHandler: UserOpMethodHandler
  let smartAccountAPI: SimpleAccountAPI
  const accountSigner = Wallet.createRandom()

  before(async () => {
    entryPoint = await new EntryPoint__factory(signer).deploy()
    DeterministicDeployer.init(provider)
    const bundlerHelperAddress = await DeterministicDeployer.deploy(new BundlerHelper__factory(), 0, [])
    const bundlerHelper = BundlerHelper__factory.connect(bundlerHelperAddress, provider)

    console.log('ep=', entryPoint.address)
    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
      bundlerHelper: bundlerHelperAddress,
      gasFactor: '0.2',
      minBalance: '0',
      mnemonic: '',
      network: '',
      port: '3000',
      unsafe: !await isGeth(provider as any),
      autoBundleInterval: 0,
      autoBundleMempoolSize: 0,
      maxBundleGas: 5e6,
      // minstake zero, since we don't fund deployer.
      minStake: '0',
      minUnstakeDelay: 0
    }

    const repMgr = new ReputationManager(BundlerReputationParams, parseEther(config.minStake), config.minUnstakeDelay)
    const mempoolMgr = new MempoolManager(repMgr)
    const validMgr = new ValidationManager(entryPoint, bundlerHelper, repMgr, config.unsafe)
    const bundleMgr = new BundleManager(entryPoint, bundlerHelper, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
    const execManager = new ExecutionManager(repMgr, mempoolMgr, bundleMgr, validMgr)
    methodHandler = new UserOpMethodHandler(
      execManager,
      provider,
      signer,
      config,
      entryPoint
    )

    debugMethodHandler = new DebugMethodHandler(execManager, repMgr, mempoolMgr)

    DeterministicDeployer.init(ethers.provider)
    const accountDeployerAddress = await DeterministicDeployer.deploy(new SimpleAccountFactory__factory(), 0, [entryPoint.address])

    smartAccountAPI = new SimpleAccountAPI({
      provider,
      entryPointAddress: entryPoint.address,
      owner: accountSigner,
      factoryAddress: accountDeployerAddress
    })
    const accountAddress = await smartAccountAPI.getAccountAddress()
    await signer.sendTransaction({
      to: accountAddress,
      value: parseEther('1')
    })
  })

  it('should return sendBundleNow hashes', async () => {
    debugMethodHandler.setBundlingMode('manual')
    const addr = await smartAccountAPI.getAccountAddress()
    const op1 = await smartAccountAPI.createSignedUserOp({
      target: addr,
      data: '0x'
    })
    const userOpHash = await methodHandler.sendUserOperation(await resolveHexlify(op1), entryPoint.address)
    const {
      transactionHash,
      userOpHashes
    } = await debugMethodHandler.sendBundleNow() as SendBundleReturn
    expect(userOpHashes).eql([userOpHash])
    const txRcpt = await provider.getTransactionReceipt(transactionHash)
    expect(txRcpt.to).to.eq(entryPoint.address)
  })
})
