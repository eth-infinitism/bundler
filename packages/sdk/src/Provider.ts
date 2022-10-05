import { JsonRpcProvider } from '@ethersproject/providers'

import { EntryPoint__factory, SimpleWalletDeployer__factory } from '@account-abstraction/contracts'

import { ClientConfig } from './ClientConfig'
import { SimpleWalletAPI } from './SimpleWalletAPI'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { HttpRpcClient } from './HttpRpcClient'
import { DeterministicDeployer } from './DeterministicDeployer'
import { Signer } from '@ethersproject/abstract-signer'
import Debug from 'debug'

const debug = Debug('aa.wrapProvider')

/**
 * wrap an existing provider to tunnel requests through Account Abstraction.
 * @param originalProvider the normal provider
 * @param config see ClientConfig for more info
 * @param originalSigner use this signer as the owner. of this wallet. By default, use the provider's signer
 */
export async function wrapProvider (
  originalProvider: JsonRpcProvider,
  config: ClientConfig,
  originalSigner: Signer = originalProvider.getSigner()
): Promise<ERC4337EthersProvider> {
  const entryPoint = new EntryPoint__factory().attach(config.entryPointAddress).connect(originalProvider)
  // Initial SimpleWallet instance is not deployed and exists just for the interface
  const simpleWalletDeployer = await DeterministicDeployer.deploy(SimpleWalletDeployer__factory.bytecode)
  const smartWalletAPI = new SimpleWalletAPI({
    provider: originalProvider,
    entryPointAddress: entryPoint.address,
    owner: originalSigner,
    factoryAddress: simpleWalletDeployer
  })
  const httpRpcClient = new HttpRpcClient(config.bundlerUrl, config.entryPointAddress, 31337)
  debug('config=', config)
  return await new ERC4337EthersProvider(
    config,
    originalSigner,
    originalProvider,
    httpRpcClient,
    entryPoint,
    smartWalletAPI
  ).init()
}
