import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-deploy'

import { HardhatUserConfig } from 'hardhat/config'

const config: HardhatUserConfig = {
  paths: {
    artifacts: '../common/artifacts'
  }
}

export default config
