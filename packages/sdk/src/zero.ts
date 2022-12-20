import '@ethersproject/shims'
import { Buffer } from 'buffer'
import { BigNumberish, ContractTransaction, ethers, Signer, Wallet } from 'ethers'
import {
  wrapProvider,
  PaymasterAPI,
  ERC4337EthersSigner
} from './index'
import { resolveProperties } from 'ethers/lib/utils'
import { UserOperationStruct } from '@account-abstraction/contracts'

import { getRpcUrl, hexifyUserOp } from './utils'
import { ErrNoIdentifierProvided, ErrTransactionFailedGasChecks } from './errors'
import * as api from './api'
import * as constants from './constants'
import { JsonRpcProvider, JsonRpcSigner } from '@ethersproject/providers'

global.Buffer = Buffer

export interface SignerParams {
  projectId: string
  identity?: string
  token?: string
  privateKey?: string
  web3Provider?: any
}

export interface AdvancedParams {
  rpcUrl?: string
  backendUrl?: string
  paymasterUrl?: string
  bundlerUrl?: string
  contractAddresses?: {
    entrypoint?: string
    paymaster?: string
    walletFactory?: string
  }
}

/*
 * @param {SignerParams} You may provide a private key, identity token, or Web3 provider
 * @param {AdvancedParams} Allows you to specify custom parts of the Account Abstraction stack
 * @returns {Signer} object that can be used to sign transactions
 */
export async function getSigner (
  params: SignerParams,
  advancedParams?: AdvancedParams
): Promise<Signer> {
  const backendUrl = advancedParams?.backendUrl ?? constants.BACKEND_URL
  const chainId = await api.getChainId(params.projectId, backendUrl)
  const rpcUrl = advancedParams?.rpcUrl ?? getRpcUrl(chainId)

  const { provider, signer } = await extractProviderAndSigner(
    params,
    rpcUrl,
    backendUrl
  )

  const paymasterAddress =
    advancedParams?.contractAddresses?.paymaster ??
    constants.PAYMASTER_ADDRESS[chainId]
  const entrypointAddress =
    advancedParams?.contractAddresses?.entrypoint ??
    constants.ENTRYPOINT_ADDRESS[chainId]
  const walletFactoryAddress =
    advancedParams?.contractAddresses?.walletFactory ??
    constants.WALLET_FACTORY_ADDRESS[chainId]

  const paymaster = new ethers.Contract(
    paymasterAddress,
    constants.PAYMASTER_ABI,
    signer
  )

  const bundlerUrl =
    advancedParams?.bundlerUrl ?? constants.BUNDLER_URL[chainId]
  const paymasterUrl = advancedParams?.paymasterUrl ?? constants.PAYMASTER_URL

  const aaConfig = {
    chainId,
    entryPointAddress: entrypointAddress,
    bundlerUrl,
    projectId: params.projectId,
    paymasterAPI: new VerifyingPaymasterAPI(
      params.projectId,
      paymaster,
      backendUrl,
      paymasterUrl
    ),
    walletFactoryAddress
  }
  const aaProvider = await wrapProvider(provider, aaConfig, signer)
  const aaSigner = aaProvider.getSigner()

  return aaSigner
}

const extractProviderAndSigner = async (
  params: SignerParams,
  rpcUrl: string,
  backendUrl: string
): Promise<{ provider: JsonRpcProvider, signer: Wallet | JsonRpcSigner }> => {
  let provider, signer

  if (params.privateKey !== undefined) {
    provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    signer = new ethers.Wallet(params.privateKey, provider)
  } else if (params.web3Provider !== undefined) {
    provider = new ethers.providers.Web3Provider(
      params.web3Provider as ethers.providers.ExternalProvider
    )
    signer = provider.getSigner()
  } else if (params.identity !== undefined && params.token !== undefined) {
    const privateKey = await api.getPrivateKeyByToken(
      params.projectId,
      params.identity,
      params.token,
      backendUrl
    )
    provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    signer = new ethers.Wallet(privateKey, provider)
  } else {
    throw ErrNoIdentifierProvided
  }

  return { provider, signer }
}

export interface Call {
  to: string
  data: string
  value?: BigNumberish
}

export async function execBatch (
  signer: Signer,
  batch: Call[],
  options?: {
    gasLimit?: number
  }
): Promise<ContractTransaction> {
  if (!(signer instanceof ERC4337EthersSigner)) {
    throw new Error('execBatch only works with a ZeroDev signer')
  }

  if (batch.length === 0) {
    throw new Error('batch must have at least one call')
  }

  // TODO: in the future we may need to support different batch function signatures.
  //       for now this is not an issue
  const wallet = new ethers.Contract(
    await signer.getAddress(),
    [
      'function execBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func)'
    ],
    signer
  )

  const dest = []
  const value = []
  const func = []
  for (const call of batch) {
    dest.push(call.to)
    value.push(call.value === undefined ? 0 : call.value)
    func.push(call.data)
  }

  return wallet.execBatch(dest, value, func, {
    gasLimit: options?.gasLimit
  })
}

class VerifyingPaymasterAPI extends PaymasterAPI {
  constructor (
    readonly projectId: string,
    readonly paymaster: ethers.Contract,
    readonly backendUrl?: string,
    readonly paymasterUrl?: string
  ) {
    super()
    this.projectId = projectId
    this.paymaster = paymaster
    this.backendUrl = backendUrl
    this.paymasterUrl = paymasterUrl
  }

  async getPaymasterAndData (
    userOp: Partial<UserOperationStruct>
  ): Promise<string | undefined> {
    const resolvedUserOp = await resolveProperties(userOp)

    const hexifiedUserOp: any = hexifyUserOp(resolvedUserOp)

    console.log(
      this.projectId,
      hexifiedUserOp,
      this.paymasterUrl
    )

    const signature = await api.signUserOp(
      this.projectId,
      hexifiedUserOp,
      this.paymasterUrl
    )
    if (signature === undefined) {
      throw ErrTransactionFailedGasChecks
    }

    return ethers.utils.hexConcat([this.paymaster.address, signature])
  }
}
