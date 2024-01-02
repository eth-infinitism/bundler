import { BigNumber, Signer, Wallet } from "ethers";
import { SafeConfig } from "../src/SafeDefaultConfig";
import { ethers, network } from "hardhat";
import { SafeAccountAPI } from "../src/SafeAccountAPI";
import { assert } from "chai";
import { initCode } from "./safeConstants";
const provider = ethers.provider;
const signer = provider.getSigner();
describe("SafeAccountAPI", () => {
  // const mnemonic =
  //   "test test test test test test test test test test test junk";
  const mnemonic =
    "shiver sweet verb spend brisk wonder series sting sweet mule cat mandate";
  const entryPoint = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
  const safeConfig: SafeConfig = {
    safeProxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
    singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
    fallbackModule: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
    aaModule: "0xa581c4A4DB7175302464fF3C06380BC3270b4037",
    addModuleLib: "0x8EcD4ec46D4D2a6B64fE960B3D64e8B94B2234eb",
    salt: BigNumber.from("0"),
  };
  let owner: Signer;
  let safeApi: SafeAccountAPI;
  let salt: BigNumber;
  before("init", async () => {
    salt = BigNumber.from(0);
    owner = Wallet.fromMnemonic(mnemonic);
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl:
              "https://polygon-mainnet.infura.io/v3/311ef590f7e5472a90edfa1316248cff",
            blockNumber: 51693186,
            setTimeout: 1000,
          },
        },
      ],
    });
    safeApi = new SafeAccountAPI({
      safeConfig: safeConfig,
      owner: owner,
      salt,
      provider: provider,
      entryPointAddress: entryPoint,
    });
  });
  it("Gives a counterfactual address", async () => {
    console.log(await owner.getAddress());
    let counterFactualAddress = await safeApi.getCounterFactualAddress();
    assert.equal(
      counterFactualAddress,
      "0x25F313a4D393D7c2f1FF8cf9bb04Bc9e174c20B9"
    );
  });
  it("Gives account initcode", async () => {
    let accountInitCode = await safeApi.getAccountInitCode();
    console.log(initCode);
    assert.equal(accountInitCode, initCode);
  });
  it("signs data", async () => {
    const op = await safeApi.createSignedUserOp({
      target: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
      data: "0x",
      value: BigNumber.from(0),
    });
    console.log(op);
  });
});
