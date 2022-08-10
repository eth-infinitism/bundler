import { deployments } from 'hardhat'

describe('ERC4337EthersSigner', function () {
  it('should load deployed hardhat fixture', async function () {
    await deployments.fixture(['BundlerHelper'])
    const bundlerHelper = await deployments.get('BundlerHelper') // Token is available because the fixture was executed
    console.log('bundlerHelper', bundlerHelper.address)
  })
})
