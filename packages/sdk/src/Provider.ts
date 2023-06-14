import { EntryPoint__factory, SimpleAccountFactory__factory } from '@account-abstraction/utils/src/ContractTypes'

import { ClientConfig } from './ClientConfig'
import { SimpleAccountAPI } from './SimpleAccountAPI'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import { HttpRpcClient } from './HttpRpcClient'
import { DeterministicDeployer } from './DeterministicDeployer'
import Debug from 'debug'
import { JsonRpcProvider, JsonRpcSigner, Provider, Signer, toNumber } from 'ethers'

const debug = Debug('aa.wrapProvider')

/**
 * wrap an existing provider to tunnel requests through Account Abstraction.
 * @param originalProvider the normal provider
 * @param config see ClientConfig for more info
 * @param originalSigner use this signer as the owner. of this wallet. By default, use the provider's signer
 */
export async function wrapProvider (
  originalProvider: Provider,
  config: ClientConfig,
  originalSigner?: Signer
): Promise<ERC4337EthersProvider> {
  if (originalSigner == null) {
    originalSigner = await (originalProvider as JsonRpcProvider).getSigner()
  }
  const entryPoint = EntryPoint__factory.connect(config.entryPointAddress, originalProvider)
  // Initial SimpleAccount instance is not deployed and exists just for the interface
  const detDeployer = new DeterministicDeployer(originalProvider)
  const SimpleAccountFactory = await detDeployer.deterministicDeploy(new SimpleAccountFactory__factory(), 0, [await entryPoint.getAddress()])
  const smartAccountAPI = new SimpleAccountAPI({
    provider: originalProvider,
    entryPointAddress: await entryPoint.getAddress(),
    owner: originalSigner,
    factoryAddress: SimpleAccountFactory,
    paymasterAPI: config.paymasterAPI
  })
  debug('config=', config)
  const chainId = await originalProvider.getNetwork().then(net => toNumber(net.chainId))
  const httpRpcClient = new HttpRpcClient(config.bundlerUrl, config.entryPointAddress, chainId)
  return await new ERC4337EthersProvider(
    chainId,
    config,
    originalSigner,
    originalProvider,
    httpRpcClient,
    entryPoint,
    smartAccountAPI
  ).init()
}
