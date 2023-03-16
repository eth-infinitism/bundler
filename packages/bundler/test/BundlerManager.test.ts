import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { parseEther } from 'ethers/lib/utils'
import { expect } from 'chai'
import { BundlerReputationParams, ReputationManager } from '../src/modules/ReputationManager'
import { UserOperation } from '../src/modules/moduleUtils'
import { AddressZero } from '@account-abstraction/utils'
import { isGeth } from '../src/utils'
import { DeterministicDeployer } from '@account-abstraction/sdk'
import { MempoolManager } from '../src/modules/MempoolManager'
import { BundleManager } from '../src/modules/BundleManager'
import { ethers } from 'hardhat'
import { BundlerConfig } from '../src/BundlerConfig'
import { ValidationManager } from '../src/modules/ValidationManager'

describe('#BundlerManager', () => {
  let bm: BundleManager

  let entryPoint: EntryPoint

  const provider = ethers.provider
  const signer = provider.getSigner()

  before(async function () {
    entryPoint = await new EntryPoint__factory(signer).deploy()
    DeterministicDeployer.init(provider)

    const config: BundlerConfig = {
      beneficiary: await signer.getAddress(),
      entryPoint: entryPoint.address,
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
    const validMgr = new ValidationManager(entryPoint, repMgr, config.unsafe)
    bm = new BundleManager(entryPoint, mempoolMgr, validMgr, repMgr, config.beneficiary, parseEther(config.minBalance), config.maxBundleGas)
  })

  it('#getUserOpHashes', async () => {
    const userOp: UserOperation = {
      sender: AddressZero,
      nonce: 1,
      paymasterAndData: '0x02',
      signature: '0x03',
      initCode: '0x04',
      callData: '0x05',
      callGasLimit: 6,
      verificationGasLimit: 7,
      maxFeePerGas: 8,
      maxPriorityFeePerGas: 9,
      preVerificationGas: 10
    }

    const hash = await entryPoint.getUserOpHash(userOp)
    const bmHash = await bm.getUserOpHashes([userOp])
    expect(bmHash).to.eql([hash])
  })
})
