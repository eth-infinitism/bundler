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
  paths: {
    artifacts: '../common/artifacts'
  }
}

export default config
