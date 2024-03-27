import { BigNumberish, BytesLike } from 'ethers'

import { encode, type List } from 'rlp'
import { BN, bnToUnpaddedBuffer, toBuffer } from 'ethereumjs-util'
import { hexlify, keccak256 } from 'ethers/lib/utils'

/**
 * The minimal operation interface that must be shared by ERC-4337 and RIP-7560 types
 * in order to use the same mempool logic implementation.
 */
export interface BaseOperation {
  sender: string
  callGasLimit: BigNumberish
  nonce: BigNumberish

  maxFeePerGas: BigNumberish
  maxPriorityFeePerGas: BigNumberish

  paymaster?: string
  factory?: string
}

export interface RIP7560Transaction extends BaseOperation {
  subtype: number
  chainId: number
  data: BytesLike
  accessList: any // NOTE: this field is not present in ERC-4337

  signature: BytesLike
  // note that this is "unpacked" struct and also contains 'paymaster' and 'deployer' fields
  paymasterData?: BytesLike
  deployerData?: BytesLike
  builderFee: BigNumberish // NOTE: this field is not present in ERC-4337
  verificationGasLimit: BigNumberish
  paymasterVerificationGasLimit?: BigNumberish
  bigNonce: BigNumberish

  // todo: consider unifying gas limits approach between 4337 and 7560
  // paymasterPostOpGasLimit?: BigNumberish
}

// TODO: this should come from the RIP-7560 utils NPM package - potentially inconsistent!
export function getRIP7560TransactionHash (tx: RIP7560Transaction, forSignature = true): string {
  const rlpEncoded = rlpEncodeType4Tx(tx, true)
  return keccak256(rlpEncoded)
  // const userOpHash = keccak256(encodeUserOp(op, true))
  // const enc = defaultAbiCoder.encode(
  //   ['bytes32', 'address', 'uint256'],
  //   [userOpHash, entryPoint, chainId])
  // return keccak256(enc)
}

function rlpEncodeType4Tx (op: RIP7560Transaction, forSignature = true): string {
  const input: List = []
  input.push(bigNumberishToUnpaddedBuffer(op.subtype))
  input.push(bigNumberishToUnpaddedBuffer(op.chainId))
  input.push(bigNumberishToUnpaddedBuffer(op.maxPriorityFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.maxFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.callGasLimit))
  // input.push(toBuffer(op.to.toString()))
  input.push(toBuffer(op.data as string))
  input.push([]) // AccessList
  input.push(toBuffer(op.sender.toString()))
  input.push(toBuffer(op.signature as string)) // Signature
  input.push(toBuffer(op.paymasterData as string))
  input.push(toBuffer(op.deployerData as string))
  input.push(bigNumberishToUnpaddedBuffer(op.builderFee))
  input.push(bigNumberishToUnpaddedBuffer(op.verificationGasLimit))
  input.push(bigNumberishToUnpaddedBuffer(op.paymasterVerificationGasLimit ?? 0))
  input.push(bigNumberishToUnpaddedBuffer(op.bigNonce ?? 0))
  input.push(toBuffer('0x0000000000000000000000000000000000000000')) // to
  input.push(bigNumberishToUnpaddedBuffer(0)) // nonce - ignored in geth
  input.push(bigNumberishToUnpaddedBuffer(0)) // value
  let rlpEncoded: any = encode(input)
  rlpEncoded = Buffer.from([4, ...rlpEncoded])
  console.log('rlpEncoded', rlpEncoded.toString('hex'))
  return hexlify(rlpEncoded)
}

function bigNumberishToUnpaddedBuffer (value: BigNumberish): Buffer {
  const bnVal = new BN(value.toString().replace('0x', ''), 'hex')
  return bnToUnpaddedBuffer(bnVal)
}
