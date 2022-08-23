import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-deploy'

import { readFileSync, existsSync } from 'fs'

import { HardhatUserConfig } from 'hardhat/config'
import { NetworkUserConfig } from 'hardhat/src/types/config'

const mnemonicFileName = process.env.MNEMONIC_FILE
let mnemonic = 'test '.repeat(11) + 'junk'
if (mnemonicFileName != null && existsSync(mnemonicFileName)) {
  console.warn('Hardhat does not seem to ')
  mnemonic = readFileSync(mnemonicFileName, 'ascii').replace(/(\r\n|\n|\r)/gm, '')
}

const infuraUrl = (name: string): string => `https://${name}.infura.io/v3/${process.env.INFURA_ID}`

function getNetwork (url: string): NetworkUserConfig {
  return {
    url,
    accounts: {
      mnemonic
    }
  }
}

function getInfuraNetwork (name: string): NetworkUserConfig {
  return getNetwork(infuraUrl(name))
}

const config: HardhatUserConfig = {
  paths: {
    artifacts: './src/artifacts',
  },
  typechain: {
    outDir: 'src/types',
    target: 'ethers-v5'
  },
  etherscan: {
    apiKey: '22E2FW3YJDPA76RETFSGYB3I41I1JHGSR9'
  },
  networks: {
    localhost: {
      url: 'http://localhost:8545/'
    },
    goerli: getInfuraNetwork('goerli')
  },
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: { enabled: true }
    }
  }
}

export default config
