import { BigNumberish } from "ethers";

export interface TransactionDetailsForUserOp {
  target: string;
  data: string;
  value?: BigNumberish;
  gasLimit?: BigNumberish;
  maxFeePerGas?: BigNumberish;
  maxPriorityFeePerGas?: BigNumberish;
  nonce?: BigNumberish;
}
export interface TransactionDetailsForMultisend {
  target: string;
  data: string;
  value: BigNumberish;
  delegateCall?: boolean;
}
