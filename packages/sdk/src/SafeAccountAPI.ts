import {
  BigNumber,
  BigNumberish,
  Signer,
  VoidSigner,
  Wallet,
  ethers,
} from "ethers";
import { BaseAccountAPI, BaseApiParams } from "./BaseAccountAPI";
import {
  EntryPoint,
  EntryPoint__factory,
  UserOperationStruct,
} from "@account-abstraction/contracts";
import {
  AbiCoder,
  BytesLike,
  Interface,
  arrayify,
  hexConcat,
  hexlify,
} from "ethers/lib/utils";
import { SafeConfig } from "./SafeDefaultConfig";
import {
  EIP712_SAFE_OPERATION_TYPE,
  SafeAbi,
  SafeModuleAbi,
  addModuleLibAbi,
  safeProxyFactoryAbi,
} from "./SafeAbis";
import { generateAddress2, keccak256, toBuffer } from "ethereumjs-util";
import { UserOperation } from "@epoch-protocol/utils";
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
  signUserOpHash(userOpHash: string): Promise<string> {
    throw new Error("Method not implemented.");
  }
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

  async signUserOp(userOp: UserOperationStruct): Promise<UserOperationStruct> {
    const validAfter = BigNumber.from(Date.now());
    const validUntil = BigNumber.from("3704202280");
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
    const signedData = await this.signSafeOp(
      this.owner,
      this.safeConfig.aaModule,
      safeUserOperation,
      await this.owner.getChainId()
    );
    const signature = this.buildSignatureBytes([signedData]);
    userOp.signature = signature;
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
  signSafeOp = async (
    signer: Signer,
    moduleAddress: string,
    safeOp: SafeUserOperation,
    chainId: BigNumberish
  ): Promise<SafeSignature> => {
    return {
      signer: await signer.getAddress(),
      data: await (signer as JsonRpcSigner)._signTypedData(
        { chainId, verifyingContract: moduleAddress },
        EIP712_SAFE_OPERATION_TYPE,
        safeOp
      ),
    };
  };
  buildSignatureBytes = (signatures: SafeSignature[]): string => {
    signatures.sort((left, right) =>
      left.signer.toLowerCase().localeCompare(right.signer.toLowerCase())
    );
    return hexlify(
      ethers.utils.concat(signatures.map((signature) => signature.data))
    );
  };
}
