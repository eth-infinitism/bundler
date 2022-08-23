import { arrayify, defaultAbiCoder, keccak256 } from 'ethers/lib/utils'

import { UserOperation } from './UserOperation'

function encode (typevalues: Array<{ type: string, val: any }>, forSignature: boolean): string {
  const types = typevalues.map(typevalue => typevalue.type === 'bytes' && forSignature ? 'bytes32' : typevalue.type)
  const values = typevalues.map((typevalue) => typevalue.type === 'bytes' && forSignature ? keccak256(typevalue.val) : typevalue.val)
  return defaultAbiCoder.encode(types, values)
}

export function packUserOp (op: UserOperation, forSignature = true): string {
  if (forSignature) {
    // lighter signature scheme (must match UserOperation#pack): do encode a zero-length signature, but strip afterwards the appended zero-length value
    const userOpType = {
      components: [
        { type: 'address', name: 'sender' },
        { type: 'uint256', name: 'nonce' },
        { type: 'bytes', name: 'initCode' },
        { type: 'bytes', name: 'callData' },
        { type: 'uint256', name: 'callGas' },
        { type: 'uint256', name: 'verificationGas' },
        { type: 'uint256', name: 'preVerificationGas' },
        { type: 'uint256', name: 'maxFeePerGas' },
        { type: 'uint256', name: 'maxPriorityFeePerGas' },
        { type: 'address', name: 'paymaster' },
        { type: 'bytes', name: 'paymasterData' },
        { type: 'bytes', name: 'signature' }
      ],
      name: 'userOp',
      type: 'tuple'
    }
    let encoded = defaultAbiCoder.encode([userOpType as any], [{ ...op, signature: '0x' }])
    // remove leading word (total length) and trailing word (zero-length signature)
    encoded = '0x' + encoded.slice(66, encoded.length - 64)
    return encoded
  }
  const typevalues = [
    { type: 'address', val: op.sender },
    { type: 'uint256', val: op.nonce },
    { type: 'bytes', val: op.initCode },
    { type: 'bytes', val: op.callData },
    { type: 'uint256', val: op.callGas },
    { type: 'uint256', val: op.verificationGas },
    { type: 'uint256', val: op.preVerificationGas },
    { type: 'uint256', val: op.maxFeePerGas },
    { type: 'uint256', val: op.maxPriorityFeePerGas },
    { type: 'address', val: op.paymaster },
    { type: 'bytes', val: op.paymasterData }
  ]
  if (!forSignature) {
    // for the purpose of calculating gas cost, also hash signature
    typevalues.push({ type: 'bytes', val: op.signature })
  }
  return encode(typevalues, forSignature)
}

export function getRequestId (op: UserOperation, entryPoint: string, chainId: number): string {
  const userOpHash = keccak256(packUserOp(op, true))
  const enc = defaultAbiCoder.encode(
    ['bytes32', 'address', 'uint256'],
    [userOpHash, entryPoint, chainId])
  return keccak256(enc)
}

export function getRequestIdForSigning (op: UserOperation, entryPoint: string, chainId: number): Uint8Array {
  return arrayify(getRequestId(op, entryPoint, chainId))
}
