import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-deploy'

import { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: 'http://localhost:8545/'
    }
  },
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: { enabled: true }
    }
  }
}

export default config
