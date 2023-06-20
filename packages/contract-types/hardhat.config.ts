import '@typechain/hardhat'
import '@nomicfoundation/hardhat-ethers'

import { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  typechain: {
    outDir: 'src/types',
    externalArtifacts: ['../../node_modules/@account-abstraction/contracts/artifacts/*'],
    target: 'ethers-v6'
  },
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: { enabled: true }
    }
  }
}

export default config
