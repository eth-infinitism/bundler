import { PromiseOrValue } from '../../bundler/src/typechain-types/common'
import { BigNumberish, BytesLike } from 'ethers'

// export type UserOperationStruct = {
// user input:
//   sender: PromiseOrValue<string>;
//   callData: PromiseOrValue<BytesLike>;


// wallet-specific:
//   nonce: PromiseOrValue<BigNumberish>;
//   initCode: PromiseOrValue<BytesLike>;
//   verificationGas: PromiseOrValue<BigNumberish>;

// paymaster-dependant
//   paymaster: PromiseOrValue<string>;
//   paymasterData: PromiseOrValue<BytesLike>;
//   verificationGas: PromiseOrValue<BigNumberish>;

// UserOp intrinsic logic:
//   callGas: PromiseOrValue<BigNumberish>;
//   preVerificationGas: PromiseOrValue<BigNumberish>;
//   maxFeePerGas: PromiseOrValue<BigNumberish>;
//   maxPriorityFeePerGas: PromiseOrValue<BigNumberish>;
//   signature: PromiseOrValue<BytesLike>;
// };


// here goes execution after all wallet-specific fields are filled.
// this class fills what is not dependent on Wallet implementation:

export class UserOpAPI {

  async getGasFees(): Promise<number> {
    return 0
  }
}
