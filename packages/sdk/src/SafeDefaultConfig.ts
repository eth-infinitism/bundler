import { BigNumber } from "ethers";

export interface SafeConfigs {
  [chainId: string]: SafeConfig;
}
export interface SafeConfig {
  safeProxyFactory: string;
  singleton: string;
  fallbackModule: string;
  aaModule: string;
  addModuleLib: string;
  salt: BigNumber;
}

export const safeDefaultConfig: SafeConfigs = {
  "1": {
    safeProxyFactory: "",
    singleton: "",
    fallbackModule: "",
    aaModule: "",
    addModuleLib: "",
    salt: BigNumber.from("0"),
  },
  "137": {
    safeProxyFactory: "",
    singleton: "",
    fallbackModule: "",
    aaModule: "",
    addModuleLib: "",
    salt: BigNumber.from("0"),
  },
};
