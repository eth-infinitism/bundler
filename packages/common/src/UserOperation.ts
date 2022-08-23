import * as type from './SolidityTypeAliases'

export interface UserOperation {
  sender: type.address
  nonce: type.uint256
  initCode: type.bytes
  callData: type.bytes
  callGas: type.uint256
  verificationGas: type.uint256
  preVerificationGas: type.uint256
  maxFeePerGas: type.uint256
  maxPriorityFeePerGas: type.uint256
  paymaster: type.address
  paymasterData: type.bytes
  signature: type.bytes
}
