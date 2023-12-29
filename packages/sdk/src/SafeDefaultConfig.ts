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
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    salt: BigNumber.from("0"),
  },
};
