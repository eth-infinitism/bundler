import { EntryPoint, EntryPoint__factory } from '@account-abstraction/contracts'
import { Signer, Wallet } from 'ethers'
import { assert, expect } from 'chai'
import fs from 'fs'
import { bundlerConfigDefault } from '../src/BundlerConfig'
import { JsonRpcProvider } from '@ethersproject/providers'
import { StorageMap } from '../src/modules/Types'
import { supportsRpcMethod } from '../src/utils'

const provider = new JsonRpcProvider('https://goerli-rollup.arbitrum.io/rpc')
const mnemonicFileName = process.env.MNEMONIC_FILE
let mnemonic: string
if (mnemonicFileName == null || !fs.existsSync(mnemonicFileName)) {
  console.error('Must provide environment variable MNEMONIC_FILE')
  process.exit(-1)
} else {
  mnemonic = fs.readFileSync(mnemonicFileName, 'ascii').trim()
}
describe.only('eth_sendRawTransactionConditional rpc endpoint', function () {
  let signedTx: string
  let entryPoint: EntryPoint
  let signer: Signer

  beforeEach(async function () {
    signer = Wallet.fromMnemonic(mnemonic.trim()).connect(provider);
    console.log('signer address', await signer.getAddress())
    entryPoint = EntryPoint__factory.connect(bundlerConfigDefault.entryPoint!, signer)
    // create tx
    const feeData = await provider.getFeeData()
    const tx = await entryPoint.populateTransaction.incrementNonce(0, {
      from: await signer.getAddress(),
      type: 2,
      nonce: await signer.getTransactionCount(),
      gasLimit: 1e5,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0,
      maxFeePerGas: feeData.maxFeePerGas ?? 0
    })
    tx.chainId = provider._network.chainId
    signedTx = await signer.signTransaction(tx)
    console.log('signedTx', signedTx)
    console.log('node url', provider.connection.url)
    // const res = await provider.sendTransaction(signedTx)
    // console.log('response is', res)
  })
  it('should check that the rpc call exists on the node', async function () {
    assert.isTrue(await supportsRpcMethod(provider as any, 'eth_sendRawTransactionConditional', [{}, {}]))
  })
  it.skip('should fail to increment nonce when blockNumberMax is too low', async function () {
    const res = await provider.send('eth_sendRawTransactionConditional', [
      signedTx,
      { blockNumberMax: '0x1'}
    ])
    console.log('wtf is res', res)
  })
  it.skip('should fail to increment nonce when timestampMax is too low', async function () {
    const res = await provider.send('eth_sendRawTransactionConditional', [
      signedTx,
      { timestampMax: '0x10'}
    ])
    console.log('wtf is res', res)
  })
  it('should fail to increment nonce when storage slot value is wrong', async function () {
    let knownAccounts: StorageMap = {}
    knownAccounts[bundlerConfigDefault.entryPoint!] = {'0x0000000000000000000000000000000000000000000000000000000000000001':'0x'+'ef'.repeat(32)}
    await expect(provider.send('eth_sendRawTransactionConditional', [
      signedTx, { knownAccounts }
    ])).to.rejectedWith('Storage slot value condition not met')
  })
  it('should fail to increment nonce when root hash value is wrong', async function () {
    let knownAccounts: StorageMap = {}
    knownAccounts[bundlerConfigDefault.entryPoint!] = '0x'+'ef'.repeat(32)
    await expect(provider.send('eth_sendRawTransactionConditional', [
      signedTx, { knownAccounts }
    ])).to.rejectedWith('Storage root hash condition not met')
  })
})
