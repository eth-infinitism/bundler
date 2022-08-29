import { JsonRpcProvider } from '@ethersproject/providers'

import { EntryPoint__factory } from '@account-abstraction/contracts'

import { ClientConfig } from './ClientConfig'
import { SimpleWalletAPI } from './SimpleWalletAPI'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { HttpRpcClient } from './HttpRpcClient'

export async function newProvider (
  originalProvider: JsonRpcProvider,
  config: ClientConfig
): Promise<ERC4337EthersProvider> {
  const originalSigner = originalProvider.getSigner()
  const entryPoint = new EntryPoint__factory().attach(config.entryPointAddress).connect(originalProvider)
  // Initial SimpleWallet instance is not deployed and exists just for the interface
  const smartWalletAPI = new SimpleWalletAPI(entryPoint, undefined, originalSigner, '', 0)
  const httpRpcClient = new HttpRpcClient(config.bundlerUrl, config.entryPointAddress, 31337)
  return await new ERC4337EthersProvider(
    config,
    originalSigner,
    originalProvider,
    httpRpcClient,
    entryPoint,
    smartWalletAPI
  ).init()
}
