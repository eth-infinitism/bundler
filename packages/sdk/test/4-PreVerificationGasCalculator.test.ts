import { ethers } from 'hardhat'
import { expect } from 'chai'
import { EXECUTE_USEROP_METHOD_SIG, PreVerificationGasCheck } from './PreVerificationGasCheck'

describe('PreVerificationGasCalculator', () => {
  let c: PreVerificationGasCheck

  before(async function () {
    this.timeout(200000)
    c = new PreVerificationGasCheck(ethers.provider, { totalGasUsed: 1e7 })
    await c.init()
    console.log('client ver=', await ethers.provider.send('web3_clientVersion', []))
  })
  beforeEach(function () {
    c.statsDict.reset()
  })
  afterEach(function () {
    console.log(this.currentTest?.title)
    c.statsDict.dump()
    if (process.env.NOCHECK == null) {
      const diff = c.statsDict.get('diff')
      expect(diff.min).to.be.within(0, 100, 'set NOCHECK to skip check')
      expect(diff.max! - diff.min!).to.be.lt(200, 'set NOCHECK to skip check')
    }
  })

  it('should check bundle sizes', async function () {
    this.timeout(200000)
    for (let bundleSize = 1; bundleSize <= 40; bundleSize += 5) {
      await c.checkPreVg({ bundleSize, callDataSize: 1000 })
    }
  })
  it('should check small calldataSize', async () => {
    for (let n = 1; n <= 500; n += 150) {
      await c.checkPreVg({ bundleSize: 1, callDataSize: n })
    }
  })
  it('should check calldataSize', async () => {
    for (let n = 1; n <= 8192; n += 150) {
      await c.checkPreVg({ bundleSize: 1, callDataSize: n })
    }
  })
  it('should check initDataSize', async function () {
    this.timeout(200000)
    for (let n = 0; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: true, factoryAppendSize: n })
    }
  })
  it('should check pmDataSize', async () => {
    for (let n = 1; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, pmDataSize: n })
    }
  })
  it('should check sigSize', async () => {
    for (let n = 1; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, sigSize: n })
    }
  })
  it('should check executeUserOp', async () => {
    for (let n = 1; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: false, callDataSize: n, callDataPrefix: EXECUTE_USEROP_METHOD_SIG })
    }
  })
  it('should check executeUserOp sig', async () => {
    for (let n = 1; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: false, sigSize: n, callDataPrefix: EXECUTE_USEROP_METHOD_SIG })
    }
  })
  it('should check executeUserOp with pmData', async () => {
    for (let n = 65; n <= 8192; n += 500) {
      await c.checkPreVg({ bundleSize: 1, useFactory: false, pmDataSize: n, callDataPrefix: EXECUTE_USEROP_METHOD_SIG })
    }
  })
})
