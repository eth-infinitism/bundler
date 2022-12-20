import aggregatorV3Abi from '@chainlink/contracts/abi/v0.8/AggregatorV3Interface.json'
import {
  InfuraProvider,
  Networkish,
  getNetwork
} from '@ethersproject/providers'
import { Contract } from '@ethersproject/contracts'
import type { BigNumber } from 'ethers'

// Always returns an AggregatorV3 contract address on Ethereum Mainnet
const getContractAddress = (chainId: number): string => {
  switch (chainId) {
    // Ethereum, Optimism, Arbitrum, Aurora
    case 1:
    case 10:
    case 42161:
    case 1313161554:
      // ETH / USD
      return '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'

    // Polygon
    case 137:
      // MATIC / USD
      return '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676'

    // Avalanche
    case 43114:
      // AVAX / USD
      return '0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7'
  }

  throw new Error('Unsupported network')
}

// Gets the latest price from Chainlink in USD
// Chainlink adds 8 decimals to the price, so you must divide by 10^8
export const getLatestPrice = async (network: Networkish): Promise<number> => {
  const provider = new InfuraProvider('mainnet', process.env.INFURA_API_KEY)
  const { chainId } = getNetwork(network)
  try {
    const address = getContractAddress(chainId)
    const contract = new Contract(address, aggregatorV3Abi, provider)
    const price: BigNumber = (await contract.latestRoundData()).answer
    return Math.floor(price.toNumber())
  } catch (_) {
    return 0
  }
}
