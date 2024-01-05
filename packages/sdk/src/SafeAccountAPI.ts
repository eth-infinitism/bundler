import { BigNumber, BigNumberish, Signer, ethers } from "ethers";
import { BaseAccountAPI, BaseApiParams } from "./BaseAccountAPI";
import {
  EntryPoint,
  EntryPoint__factory,
  UserOperationStruct,
} from "@account-abstraction/contracts";
import { AbiCoder, BytesLike, hexConcat, hexlify } from "ethers/lib/utils";
import { SafeConfig } from "./SafeDefaultConfig";
import {
  EIP712_SAFE_OPERATION_TYPE,
  SafeAbi,
  SafeModuleAbi,
  addModuleLibAbi,
  safeProxyFactoryAbi,
} from "./SafeAbis";
import { generateAddress2, keccak256, toBuffer } from "ethereumjs-util";
import { JsonRpcSigner } from "@ethersproject/providers";

export interface SafeAccountApiParams extends BaseApiParams {
  owner: Signer;
  safeConfig: SafeConfig;
  salt: BigNumber;
}

export interface SafeUserOperation {
  safe: string;
  nonce: BigNumberish;
  initCode: BytesLike;
  callData: BytesLike;
  callGasLimit: BigNumberish;
  verificationGasLimit: BigNumberish;
  preVerificationGas: BigNumberish;
  maxFeePerGas: BigNumberish;
  maxPriorityFeePerGas: BigNumberish;
  paymasterAndData: BytesLike;
  validAfter: BigNumberish;
  validUntil: BigNumberish;
  entryPoint: string;
}

export interface SafeSignature {
  signer: string;
  data: string;
}

export class SafeAccountAPI extends BaseAccountAPI {
  owner: Signer;
  entrypointContract: EntryPoint;
  safeConfig: SafeConfig;
  salt: BigNumber;
  abiCoder: AbiCoder;

  constructor(params: SafeAccountApiParams) {
    super(params);

    this.owner = params.owner;
    this.safeConfig = params.safeConfig;
    this.salt = params.salt;
    this.abiCoder = new ethers.utils.AbiCoder();
    this.entrypointContract = EntryPoint__factory.connect(
      this.entryPointAddress,
      this.provider
    );
  }

  async _getAccountContract(): Promise<ethers.Contract> {
    const safeInterface = new ethers.utils.Interface(SafeAbi);
    const safeProxy = new ethers.Contract(
      await this.getCounterFactualAddress(),
      safeInterface
    );
    return safeProxy;
  }

  async _getEntrypointContract(): Promise<EntryPoint> {
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

    const entrypoint = await this._getEntrypointContract();
    if (key) {
      return entrypoint.getNonce(accountContract.address, key);
    }
    return entrypoint.getNonce(accountContract.address, 0);
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

  async signUserOp(userOp: UserOperationStruct): Promise<UserOperationStruct> {
    const validAfter = BigNumber.from(Math.floor(Date.now() / 1000));
    // Valid Until 365 days
    const validUntil = validAfter.add(31536000);

    const safeUserOperation: SafeUserOperation = {
      safe: await userOp.sender,
      nonce: await userOp.nonce,
      initCode: await userOp.initCode,
      callData: await userOp.callData,
      callGasLimit: await userOp.callGasLimit,
      verificationGasLimit: await userOp.verificationGasLimit,
      preVerificationGas: await userOp.preVerificationGas,
      maxFeePerGas: await userOp.maxFeePerGas,
      maxPriorityFeePerGas: await userOp.maxPriorityFeePerGas,
      paymasterAndData: await userOp.paymasterAndData,
      entryPoint: this.entryPointAddress,
      validAfter,
      validUntil,
    };

    const signature = this.buildSignatureBytes([
      await this.signSafeOp(
        this.owner,
        this.safeConfig.aaModule,
        safeUserOperation,
        await this.owner.getChainId()
      ),
    ]);

    userOp.signature = ethers.utils.solidityPack(
      ["uint48", "uint48", "bytes"],
      [validAfter, validUntil, signature]
    );

    return userOp;
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

  async signSafeOp(
    signer: Signer,
    moduleAddress: string,
    safeOp: SafeUserOperation,
    chainId: BigNumberish
  ): Promise<SafeSignature> {
    return {
      signer: await signer.getAddress(),
      data: await (signer as JsonRpcSigner)._signTypedData(
        { chainId, verifyingContract: moduleAddress },
        EIP712_SAFE_OPERATION_TYPE,
        safeOp
      ),
    };
  }

  buildSignatureBytes(signatures: SafeSignature[]): string {
    signatures.sort((left, right) =>
      left.signer.toLowerCase().localeCompare(right.signer.toLowerCase())
    );
    return hexlify(
      ethers.utils.concat(signatures.map((signature) => signature.data))
    );
  }

  signUserOpHash(userOpHash: string): Promise<string> {
    throw new Error(`Method not implemented for SAFE Wallets, ${userOpHash}`);
  }
}
