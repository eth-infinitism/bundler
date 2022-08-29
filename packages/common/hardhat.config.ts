// import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-toolbox'

import { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  typechain: {
    outDir: 'src/types',
    target: 'ethers-v5'
  },
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: { enabled: true }
    }
  }
}

export default config
