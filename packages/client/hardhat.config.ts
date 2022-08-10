import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-deploy'
import * as fs from 'fs'

const mnemonicFile: string | undefined = process.env.MNEMONIC_FILE
const accounts = mnemonicFile == undefined ? undefined : {
  mnemonic: fs.readFileSync(process.env.MNEMONIC_FILE as string, 'ascii')
}

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: { enabled: true }
    }
  },
  networks: {
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_ID}`,
      accounts
    },
    dev: {
      url: 'http://localhost:8545',
      //  accounts
    }
  },
  namedAccounts: {
    deployer: {
      default: 0
    }
  }
}

export default config
