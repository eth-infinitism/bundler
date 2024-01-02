import { BigNumber, BigNumberish, Signer, Wallet, ethers } from "ethers";
import { BaseAccountAPI, BaseApiParams } from "./BaseAccountAPI";
import {
  EntryPoint,
  EntryPoint__factory,
} from "@account-abstraction/contracts";
import { AbiCoder, Interface, arrayify, hexConcat } from "ethers/lib/utils";
import { SafeConfig } from "./SafeDefaultConfig";
import {
  SafeAbi,
  SafeModuleAbi,
  addModuleLibAbi,
  safeProxyFactoryAbi,
} from "./SafeAbis";
import { generateAddress2, keccak256, toBuffer } from "ethereumjs-util";

export interface SafeAccountApiParams extends BaseApiParams {
  owner: Signer;
  safeConfig: SafeConfig;
  salt: BigNumber;
}

export class SafeAccountAPI extends BaseAccountAPI {
  owner: Signer;
  entrypointContract?: EntryPoint;
  safeConfig: SafeConfig;
  salt: BigNumber;
  abiCoder: AbiCoder;
  constructor(params: SafeAccountApiParams) {
    super(params);
    this.owner = params.owner;
    this.safeConfig = params.safeConfig;
    this.salt = params.salt;
    this.abiCoder = new ethers.utils.AbiCoder();
  }
  async _getAccountContract(): Promise<ethers.Contract> {
    const safeInterface = new ethers.utils.Interface(SafeAbi);
    const safeProxy = new ethers.Contract(
      await this.getCounterFactualAddress(),
      safeInterface
    );
    return safeProxy;
  }

  async _getEntrypointContract(): Promise<EntryPoint | undefined> {
    if (
      this.entrypointContract == null &&
      this.entryPointAddress &&
      this.entryPointAddress !== ""
    ) {
      this.entrypointContract = EntryPoint__factory.connect(
        this.entryPointAddress,
        this.provider
      );
    }
    return this.entrypointContract;
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode(): Promise<string> {
    let encodedSetup = await this._getSetupCode();
    const safeProxyFactoryInterface = new ethers.utils.Interface(
      safeProxyFactoryAbi
    );
    const safeProxyFactoryEncodedCallData =
      safeProxyFactoryInterface.encodeFunctionData("createProxyWithNonce", [
        this.safeConfig.singleton,
        encodedSetup,
        this.safeConfig.salt,
      ]);
    return hexConcat([
      this.safeConfig.safeProxyFactory,
      safeProxyFactoryEncodedCallData,
    ]);
  }
  async getCounterFactualAddress(): Promise<string> {
    const encodedNonce = toBuffer(
      this.abiCoder.encode(["uint256"], [this.salt])
    ).toString("hex");
    const initializer = await this._getSetupCode();
    const salt = keccak256(
      toBuffer(
        "0x" + keccak256(toBuffer(initializer)).toString("hex") + encodedNonce
      )
    );
    const input = this.abiCoder.encode(
      ["address"],
      [this.safeConfig.singleton]
    );
    const from = this.safeConfig.safeProxyFactory;

    const proxyFactory = new ethers.Contract(
      this.safeConfig.safeProxyFactory,
      safeProxyFactoryAbi,
      this.provider
    );

    const creationCode = await proxyFactory.functions.proxyCreationCode();

    const constructorData = toBuffer(input).toString("hex");
    const initCode = creationCode + constructorData;
    const proxyAddress =
      "0x" +
      generateAddress2(
        toBuffer(from),
        toBuffer(salt),
        toBuffer(initCode)
      ).toString("hex");

    return ethers.utils.getAddress(proxyAddress);
  }

  async getNonce(key?: string): Promise<BigNumber> {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0);
    }
    const accountContract = await this._getAccountContract();

    if (key) {
      const entrypoint = await this._getEntrypointContract();
      if (entrypoint) {
        return entrypoint.getNonce(accountContract.address, key);
      }
    }
    const safeProxy = new ethers.Contract(
      await this.getCounterFactualAddress(),
      SafeAbi
    );
    return await safeProxy.functions.getNonce();
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  async encodeExecute(
    target: string,
    value: BigNumberish,
    data: string
  ): Promise<string> {
    const safeInterface = new ethers.utils.Interface(SafeModuleAbi);

    return safeInterface.encodeFunctionData("executeUserOp", [
      target,
      value,
      data,
      BigNumber.from(0),
    ]);
  }

  async signUserOpHash(userOpHash: string): Promise<string> {
    const now = BigNumber.from(Date.now());
    const validUntil = BigNumber.from("3704202280");
    const sig = await this.owner.signMessage(arrayify(userOpHash));
    const encoded = this.abiCoder.encode(
      ["uint256, uint256, bytes"],
      [now, validUntil, sig]
    );
    return encoded;
  }

  async _getSetupCode(): Promise<string> {
    const addModuleLibInterface = new ethers.utils.Interface(addModuleLibAbi);
    const initData = addModuleLibInterface.encodeFunctionData("enableModules", [
      [this.safeConfig.aaModule],
    ]);
    const threshold = BigNumber.from(1);
    const safeInterface = new ethers.utils.Interface(SafeAbi);
    const encodedSetup = safeInterface.encodeFunctionData("setup", [
      [await this.owner.getAddress()],
      threshold,
      this.safeConfig.addModuleLib,
      initData,
      this.safeConfig.aaModule,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero,
    ]);
    return encodedSetup;
  }
}
