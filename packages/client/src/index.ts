import { ethers } from 'ethers'
import { JsonRpcProvider } from '@ethersproject/providers'

import { EntryPoint__factory, SimpleWallet__factory } from '@erc4337/common/dist/src/types'

import { ClientConfig } from './ClientConfig'
import { SimpleWalletAPI } from './SimpleWalletAPI'
import { UserOpAPI } from './UserOpAPI'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { HttpRpcClient } from './HttpRpcClient'

export async function newProvider (
  originalProvider: JsonRpcProvider,
  config: ClientConfig
): Promise<ERC4337EthersProvider> {
  const originalSigner = originalProvider.getSigner()
  const ownerAddress = await originalSigner.getAddress()
  const entryPoint = new EntryPoint__factory().attach(config.entryPointAddress).connect(originalProvider)
  // Initial SimpleWallet instance is not deployed and exists just for the interface
  const simpleWallet = new SimpleWallet__factory().attach(ethers.constants.AddressZero)
  const smartWalletAPI = new SimpleWalletAPI(simpleWallet, entryPoint, originalProvider, ownerAddress)
  const userOpAPI = new UserOpAPI()
  const httpRpcClient = new HttpRpcClient(config.bundlerUrl, config.entryPointAddress, 31337)
  return await new ERC4337EthersProvider(
    config,
    originalSigner,
    originalProvider,
    httpRpcClient,
    entryPoint,
    smartWalletAPI,
    userOpAPI
  ).init()
}
