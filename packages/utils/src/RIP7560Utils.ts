import { BigNumberish, BytesLike } from 'ethers'

import { encode, type List } from 'rlp'
import { BN, bnToUnpaddedBuffer, toBuffer } from 'ethereumjs-util'
import { hexlify, keccak256 } from 'ethers/lib/utils'

import { OperationRIP7560 } from './interfaces/OperationRIP7560'

export function getRIP7560TransactionHash (op: OperationRIP7560, forSignature = true): string {
  if (!forSignature) {
    throw new Error('not implemented')
  }
  const rlpEncoded = rlpEncodeRip7560Tx(op, true)
  return keccak256(rlpEncoded)
}

function rlpEncodeRip7560Tx (op: OperationRIP7560, forSignature = true): string {
  const input: List = []
  input.push(bigNumberishToUnpaddedBuffer(op.chainId))
  input.push(bigNumberishToUnpaddedBuffer(op.maxPriorityFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.maxFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.callGasLimit))
  input.push(toBuffer(op.callData as string))
  input.push([]) // AccessList
  input.push(toBuffer(op.sender.toString()))
  input.push(toBuffer(op.signature as string)) // Signature
  input.push(toBuffer(op.paymasterData as string))
  input.push(toBuffer(op.factoryData as string))
  input.push(bigNumberishToUnpaddedBuffer(op.builderFee))
  input.push(bigNumberishToUnpaddedBuffer(op.verificationGasLimit))
  input.push(bigNumberishToUnpaddedBuffer(op.paymasterVerificationGasLimit ?? 0))
  input.push(toBuffer('0x0000000000000000000000000000000000000000')) // to
  input.push(bigNumberishToUnpaddedBuffer(0)) // nonce - ignored in geth
  input.push(bigNumberishToUnpaddedBuffer(0)) // value
  let rlpEncoded: any = encode(input)
  rlpEncoded = Buffer.from([4, ...rlpEncoded])
  return hexlify(rlpEncoded)
}

function bigNumberishToUnpaddedBuffer (value: BigNumberish): Buffer {
  const bnVal = new BN(value.toString().replace('0x', ''), 'hex')
  return bnToUnpaddedBuffer(bnVal)
}
