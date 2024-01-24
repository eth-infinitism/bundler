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
  multisend: string;
  salt: BigNumber;
}

export const safeDefaultConfig: SafeConfigs = {
  // "1": {
  //   safeProxyFactory: "",
  //   singleton: "",
  //   fallbackModule: "",
  //   aaModule: "",
  //   addModuleLib: "",
  //   salt: BigNumber.from("0"),
  // },
  "137": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "80001": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "11155111": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "59140": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "59144": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "11155420": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "10": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "42161": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "421614": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
  "56": {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    multisend: "0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",
    salt: BigNumber.from("0"),
  },
};
