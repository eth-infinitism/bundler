import { BigNumber, Signer, Wallet } from "ethers";
import { SafeConfig, safeDefaultConfig } from "../src/SafeDefaultConfig";
import { ethers, network } from "hardhat";
import { SafeAccountAPI } from "../src/SafeAccountAPI";
import { assert } from "chai";
import { initCode } from "./safeConstants";
import { HttpRpcClient } from "../src";

import { DEFAULT_MNEMONIC } from "../hardhat.config";

const provider = ethers.provider;
const signer = provider.getSigner();

describe("SafeAccountAPI", () => {
  const entryPoint = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

  let owner: Signer;
  let safeApi: SafeAccountAPI;
  let salt: BigNumber;

  before("init", async () => {
    salt = BigNumber.from(0);
    owner = Wallet.fromMnemonic(DEFAULT_MNEMONIC);
    // await network.provider.request({
    //   method: "hardhat_reset",
    //   params: [
    //     {
    //       forking: {
    //         jsonRpcUrl: "https://rpc.ankr.com/polygon_mumbai",
    //         blockNumber: 44319182,
    //         setTimeout: 1000,
    //       },
    //     },
    //   ],
    // });
    owner = owner.connect(provider);

    safeApi = new SafeAccountAPI({
      safeConfig: safeDefaultConfig["80001"],
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
      target: await owner.getAddress(),
      data: "0x",
      value: ethers.utils.parseEther("0.00001"),
    });

    // const op = {
    //   sender: "0x3094A3137bE3d308014Ce7BBC7d9Df78F452Dc06",
    //   nonce: "0x01",
    //   initCode: "0x",
    //   callData:
    //     "0x7bb37428000000000000000000000000e1afc1092c40d32f72ad065c93f6d27843458b950000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    //   callGasLimit: "0x1e8480",
    //   verificationGasLimit: "0x07a120",
    //   preVerificationGas: "0xea60",
    //   maxFeePerGas: "0x02540be400",
    //   maxPriorityFeePerGas: "0x02540be400",
    //   paymasterAndData: "0x",
    //   signature:
    //     "0x000000000000000000000000989795e71ba1b300de08a27a1f6bcf554f506d34a95591a9315c187fe949a4bf2a481401654648680d31037d6a796462f04f7ca8cc7e35ffdd1eb2a63c3df9e21b",
    // };
    // console.log(JSON.stringify(op));
    // const op = {
    //   sender: "0x3094A3137bE3d308014Ce7BBC7d9Df78F452Dc06",
    //   safe: "0x3094A3137bE3d308014Ce7BBC7d9Df78F452Dc06",
    //   nonce: "1",
    //   initCode: "0x",
    //   callData:
    //     "0x7bb37428000000000000000000000000e1afc1092c40d32f72ad065c93f6d27843458b950000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    //   callGasLimit: 2000000,
    //   verificationGasLimit: 500000,
    //   preVerificationGas: 60000,
    //   maxFeePerGas: 10000000000,
    //   maxPriorityFeePerGas: 10000000000,
    //   paymasterAndData: "0x",
    //   validAfter: 0,
    //   validUntil: 0,
    //   entryPoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    //   signature: "",
    // };
    // console.log(op.signature.toString());

    const signedUserOp = await safeApi.signUserOp(op);
    console.log("signedUserOp: ", signedUserOp);
    const ENTRY_POINT = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

    const bundlerUrl: string =
      process.env.NEXT_PUBLIC_BUNDLER_URL ?? "http://localhost:14337/80001";
    console.log(
      "parseInt((await provider.getNetwork()).chainId.toString()): ",
      parseInt((await provider.getNetwork()).chainId.toString())
    );

    const bundler = new HttpRpcClient(bundlerUrl, ENTRY_POINT, 80001);
    const deployWalletUserOp = await bundler.sendUserOpToBundler(op);
    console.log("deployWalletUserOp: ", deployWalletUserOp);
  });
  it("get user operations", async () => {
    const rpcClient = new HttpRpcClient(
      "http://0.0.0.0:14337/80001",
      "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      80001
    );
    const response = await rpcClient.getAdvancedUserOperations(
      "0x278160b87c275d453FE5d65BaE5001a06799cF6f"
    );
  });
});
