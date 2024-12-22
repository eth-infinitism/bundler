import { JsonRpcProvider } from '@ethersproject/providers'
import { spy } from 'sinon'
import { assert } from 'chai'

import { BundlerServer } from '../src/BundlerServer'
import { MethodHandlerERC4337 } from '../src/MethodHandlerERC4337'
import { MethodHandlerRIP7560 } from '../src/MethodHandlerRIP7560'
import { initServer } from '../src/modules/initServer'
import { resolveConfiguration } from '../src/Config'
import { DebugMethodHandler } from '../src/DebugMethodHandler'
import { parseEther } from 'ethers/lib/utils'
import { OperationRIP7560, sleep } from '@account-abstraction/utils'

describe.skip('RIP7560Mode', function () {
  describe('running bundler in the RIP-7560 mode', function () {
    let ethersProviderSpy: any
    let operationRIP7560: OperationRIP7560

    // TODO: 'runBundler' is a spaghetti but this code is mostly copied from there - refactor to reuse
    before(async function () {
      const { config, provider, wallet } = await resolveConfiguration({
        // todo: add default values for all that
        beneficiary: '',
        gasFactor: '1',
        minBalance: '1',
        mnemonic: './mnemonic.txt',
        network: '',
        maxBundleGas: 0,
        autoBundleInterval: 0,
        autoBundleMempoolSize: 0,
        useRip7560Mode: true
      })
      const signer = provider.getSigner()

      // we stub the ValidationManagerRIP7560 so the values of these fields do not matter
      operationRIP7560 = {
        accessList: undefined,
        nonceKey: '0x0',
        nonce: '0x0',
        sender: '0x0000000000000000000000000000000000000000',
        callGasLimit: '0x0',
        maxFeePerGas: '0x0',
        maxPriorityFeePerGas: '0x0',
        factoryData: '0x',
        chainId: '0x0',
        value: '0x0',
        authorizationData: '0x',
        verificationGasLimit: '0x0',
        paymasterVerificationGasLimit: '0x0',
        paymasterPostOpGasLimit: '0x0',
        builderFee: '0x0',
        executionData: '0x',
        paymasterData: '0x',
        authorizationList: []
      }

      // fund deployment of the EntryPoint contract
      await signer.sendTransaction({ to: await wallet.getAddress(), value: parseEther('1') })

      const [execManager] = initServer(config, signer)

      // spy on the underlying ExecutionManager provider 'send' function
      // @ts-ignore
      ethersProviderSpy = spy(execManager.bundleManager.provider.send)
      // @ts-ignore
      execManager.bundleManager.provider.send = ethersProviderSpy

      const methodHandlerRip7560 = new MethodHandlerRIP7560(
        execManager,
        signer.provider
      )
      // eslint-disable-next-line no-new
      new BundlerServer(
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as MethodHandlerERC4337,
        methodHandlerRip7560,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as DebugMethodHandler,
        config,
        ethersProviderSpy,
        wallet
      )
    })

    it('should accept eth_sendTransaction requests with RIP-7560 transactions', async function () {
      const provider = new JsonRpcProvider('http://127.0.0.1:3000/rpc')
      await provider.send('eth_sendTransaction', [operationRIP7560])
      await sleep(3000)
      assert(ethersProviderSpy.calledWith('eth_sendRip7560TransactionsBundle'))
      assert(ethersProviderSpy.calledWith('eth_getRip7560BundleStatus'))
    })
  })
})
