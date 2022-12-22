export const BACKEND_URL =
  process.env.REACT_APP_ZERODEV_BACKEND_URL ??
  'https://backend-vikp.onrender.com'

export const PAYMASTER_URL =
  process.env.REACT_APP_ZERODEV_PAYMASTER_URL ??
  'https://paymaster-server.onrender.com'

export { abi as PAYMASTER_ABI } from '@zerodevapp/contracts/artifacts/BasePaymaster.json'

export const ENTRYPOINT_ADDRESS: { [key: string]: string } = {
  5: '0x49bd26a61DABE4D9F5B8e2B4fD947B9b250D30B9',
  137: '0xaec9CE12Edd21BD042967008d24fD4ab12C745E5',
  43113: '0x49bd26a61DABE4D9F5B8e2B4fD947B9b250D30B9',
  43114: '0xaec9CE12Edd21BD042967008d24fD4ab12C745E5',
  80001: '0xaec9CE12Edd21BD042967008d24fD4ab12C745E5'
}

export const WALLET_FACTORY_ADDRESS: { [key: string]: string } = {
  5: '0x6D261eD72837f4001d4Cc89f9002ddb5AB3a93B2',
  137: '0x6D261eD72837f4001d4Cc89f9002ddb5AB3a93B2',
  43113: '0x6D261eD72837f4001d4Cc89f9002ddb5AB3a93B2',
  43114: '0x6D261eD72837f4001d4Cc89f9002ddb5AB3a93B2',
  80001: '0x6D261eD72837f4001d4Cc89f9002ddb5AB3a93B2'
}

export const BUNDLER_URL: { [key: string]: string } = {
  5: 'https://goerli-bundler.onrender.com/rpc',
  137: 'https://polygon-bundler.onrender.com/rpc',
  43113: 'https://fuji-bundler.onrender.com/rpc',
  43114: 'https://avalanche-bundler.onrender.com/rpc',
  80001: 'https://bundler.onrender.com/rpc'
}

export const PAYMASTER_ADDRESS: { [key: string]: string } = {
  5: '0x2E59ebb954BF7B0e1FB63c3B2F583C35C31Cd604',
  137: '0x2E59ebb954BF7B0e1FB63c3B2F583C35C31Cd604',
  43113: '0x2E59ebb954BF7B0e1FB63c3B2F583C35C31Cd604',
  43114: '0x5aa766cEC2768ae505deC6dF46fE5769C433b6D2',
  80001: '0x73a073E6e3C2A0020995Fcc380ef86718c6ff6f3'
}

export const INFURA_API_KEY = 'f36f7f706a58477884ce6fe89165666c'

export const CHAIN_ID_TO_INFURA_NAMES: { [key: string]: string } = {
  1: 'mainnet',
  5: 'goerli',
  137: 'polygon-mainnet',
  80001: 'polygon-mumbai',
  10: 'optimism-mainnet',
  420: 'optimism-goerli',
  42161: 'arbitrum-mainnet',
  421613: 'arbitrum-goerli',
  43114: 'avalanche-mainnet',
  43113: 'avalanche-fuji',
  1313161554: 'aurora-mainnet',
  1313161555: 'aurora-testnet'
}
