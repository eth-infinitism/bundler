import { BigNumber, BigNumberish } from 'ethers'

import { encode, type Input } from 'rlp'
import { toBuffer } from 'ethereumjs-util'
import { hexlify, keccak256 } from 'ethers/lib/utils'

import { OperationRIP7560 } from './interfaces/OperationRIP7560'
import { AddressZero } from './ERC4337Utils'

export const RIP7560_TRANSACTION_TYPE = 5

export function getRIP7560TransactionHash (op: OperationRIP7560, forSignature = true): string {
  if (!forSignature) {
    throw new Error('not implemented')
  }
  const rlpEncoded = rlpEncodeRip7560Tx(op, true)
  return keccak256(rlpEncoded)
}

function nonZeroAddr (addr?: string): Buffer {
  if (addr == null || addr === AddressZero) {
    return Buffer.from([])
  }
  return toBuffer(addr)
}

function rlpEncodeRip7560Tx (op: OperationRIP7560, forSignature = true): string {
  const input: Input = []
  input.push(bigNumberishToUnpaddedBuffer(op.chainId))
  input.push(bigNumberishToUnpaddedBuffer(op.nonce))
  input.push(bigNumberishToUnpaddedBuffer(op.maxPriorityFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.maxFeePerGas))
  input.push(bigNumberishToUnpaddedBuffer(op.callGasLimit))
  input.push([]) // AccessList
  input.push(nonZeroAddr(op.sender))
  input.push(toBuffer(op.authorizationData as string))
  input.push(toBuffer(op.executionData as string))
  input.push(nonZeroAddr(op.paymaster))
  input.push(toBuffer(op.paymasterData as string))
  input.push(nonZeroAddr(op.factory))
  input.push(toBuffer(op.factoryData as string))
  input.push(bigNumberishToUnpaddedBuffer(op.builderFee))
  input.push(bigNumberishToUnpaddedBuffer(op.verificationGasLimit))
  input.push(bigNumberishToUnpaddedBuffer(op.paymasterVerificationGasLimit ?? 0))
  input.push(bigNumberishToUnpaddedBuffer(op.paymasterPostOpGasLimit ?? 0))
  input.push(bigNumberishToUnpaddedBuffer(op.nonceKey))
  let rlpEncoded: any = encode(input)
  rlpEncoded = Buffer.from([RIP7560_TRANSACTION_TYPE, ...rlpEncoded])
  return hexlify(rlpEncoded)
}

function bigNumberishToUnpaddedBuffer (value: BigNumberish): Buffer {
  const b = BigNumber.from(value).toHexString()
  if (b === '0x00') {
    return Buffer.from([])
  }
  return Buffer.from(b.slice(2), 'hex')
}
