import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-toolbox";

import { HardhatUserConfig } from "hardhat/config";

export const DEFAULT_MNEMONIC =
  process.env.MNEMONIC ||
  "test test test test test test test test test test test junk";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.15",
    settings: {
      optimizer: { enabled: true },
    },
  },
  networks: {
    hardhat: {
      blockGasLimit: 100000000,
      gas: 100000000,
      gasPrice: 10000000000,
      accounts: {
        mnemonic: DEFAULT_MNEMONIC,
      },
      // forking: {
      //   url: "https://rpc.ankr.com/polygon_mumbai",
      // },
    },
    mumbai: {
      url: `https://rpc.ankr.com/polygon_mumbai`,
      accounts: {
        mnemonic: DEFAULT_MNEMONIC,
      },
    },
  },
};

export default config;
