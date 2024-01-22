import {
  defaultAbiCoder,
  hexConcat, hexDataLength,
  hexDataSlice,
  hexlify,
  hexZeroPad,
  keccak256,
  resolveProperties
} from 'ethers/lib/utils'
import { PackedUserOperationStruct } from '@account-abstraction/contracts'
import { abi as entryPointAbi } from '@account-abstraction/contracts/artifacts/IEntryPoint.json'
import { BigNumber, BigNumberish, BytesLike, ethers } from 'ethers'
import Debug from 'debug'
import { PackedUserOperation } from './Utils'

const debug = Debug('aa.utils')

// UserOperation is the first parameter of getUserOpHash
const getUserOpHashMethod = 'getUserOpHash'
const PackedUserOpType = entryPointAbi.find(entry => entry.name === getUserOpHashMethod)?.inputs[0]
if (PackedUserOpType == null) {
  throw new Error(`unable to find method ${getUserOpHashMethod} in EP ${entryPointAbi.filter(x => x.type === 'function').map(x => x.name).join(',')}`)
}

export const AddressZero = ethers.constants.AddressZero

// reverse "Deferrable" or "PromiseOrValue" fields
export type NotPromise<T> = {
  [P in keyof T]: Exclude<T[P], Promise<any>>
}

export interface UserOperation {

  sender: string
  nonce: BigNumberish
  factory?: string
  factoryData?: BytesLike
  callData: BytesLike
  callGasLimit: BigNumberish
  verificationGasLimit: BigNumberish
  preVerificationGas: BigNumberish
  maxFeePerGas: BigNumberish
  maxPriorityFeePerGas: BigNumberish
  paymaster?: string
  paymasterVerificationGasLimit?: BigNumberish
  paymasterPostOpGasLimit?: BigNumberish
  paymasterData?: BytesLike
  signature: BytesLike
}

export function packAccountGasLimits (validationGasLimit: BigNumberish, callGasLimit: BigNumberish): string {
  return hexZeroPad(BigNumber.from(validationGasLimit).shl(128).add(callGasLimit).toHexString(), 32)
}

export function unpackAccountGasLimits (accountGasLimits: BytesLike): {
  verificationGasLimit: BigNumber
  callGasLimit: BigNumber
} {
  const limits: BigNumber = BigNumber.from(accountGasLimits)
  return {
    verificationGasLimit: limits.shr(128),
    callGasLimit: limits.and(BigNumber.from(1).shl(128).sub(1))
  }
}

export function packPaymasterData (paymaster: string, paymasterVerificationGasLimit: BigNumberish, postOpGasLimit: BigNumberish, paymasterData?: BytesLike): BytesLike {
  return ethers.utils.hexConcat([
    paymaster,
    packAccountGasLimits(paymasterVerificationGasLimit, postOpGasLimit),
    paymasterData ?? '0x'
  ])
}

export function unpackPaymasterAndData (paymasterAndData: BytesLike): {
  paymaster: string
  paymasterVerificationGas: BigNumber
  postOpGasLimit: BigNumber
  paymasterData: BytesLike
} | null {
  if (paymasterAndData.length <= 2) return null
  if (hexDataLength(paymasterAndData) < 52) {
    // if length is non-zero, then must at least host paymaster address and gas-limits
    throw new Error(`invalid PaymasterAndData: ${paymasterAndData as string}`)
  }
  const {
    verificationGasLimit: paymasterVerificationGas,
    callGasLimit: postOpGasLimit
  } = unpackAccountGasLimits(hexDataSlice(paymasterAndData, 20, 52))
  return {
    paymaster: hexDataSlice(paymasterAndData, 0, 20),
    paymasterVerificationGas,
    postOpGasLimit,
    paymasterData: hexDataSlice(paymasterAndData, 52)
  }
}

export function packUserOp (op: UserOperation): PackedUserOperation {
  let paymasterAndData: BytesLike
  if (op.paymaster == null) {
    paymasterAndData = '0x'
  } else {
    if (op.paymasterVerificationGasLimit == null || op.paymasterPostOpGasLimit == null) {
      throw new Error('paymaster with no gas limits')
    }
    paymasterAndData = packPaymasterData(op.paymaster, op.paymasterVerificationGasLimit, op.paymasterPostOpGasLimit, op.paymasterData)
  }
  return {
    sender: op.sender,
    nonce: BigNumber.from(op.nonce).toHexString(),
    initCode: op.factory == null ? '0x' : hexConcat([op.factory, op.factoryData ?? '']),
    callData: op.callData,
    accountGasLimits: packAccountGasLimits(op.verificationGasLimit, op.callGasLimit),
    preVerificationGas: BigNumber.from(op.preVerificationGas).toHexString(),
    maxFeePerGas: BigNumber.from(op.maxFeePerGas).toHexString(),
    maxPriorityFeePerGas: BigNumber.from(op.maxPriorityFeePerGas).toHexString(),
    paymasterAndData,
    signature: op.signature
  }
}

export function unpackUserOp (packed: PackedUserOperation): UserOperation {
  const { callGasLimit, verificationGasLimit } = unpackAccountGasLimits(packed.accountGasLimits)
  let ret: UserOperation = {
    sender: packed.sender,
    nonce: packed.nonce,
    callData: packed.callData,
    preVerificationGas: packed.preVerificationGas,
    verificationGasLimit,
    callGasLimit,
    maxFeePerGas: packed.maxFeePerGas,
    maxPriorityFeePerGas: packed.maxFeePerGas,
    signature: packed.signature
  }
  if (packed.initCode != null && packed.initCode.length > 2) {
    const factory = hexDataSlice(packed.initCode, 0, 20)
    const factoryData = hexDataSlice(packed.initCode, 20)
    ret = { ...ret, factory, factoryData }
  }
  const pmData = unpackPaymasterAndData(packed.paymasterAndData)
  if (pmData != null) {
    ret = {
      ...ret,
      paymaster: pmData.paymaster,
      paymasterVerificationGasLimit: pmData.paymasterVerificationGas,
      paymasterPostOpGasLimit: pmData.postOpGasLimit,
      paymasterData: pmData.paymasterData
    }
  }
  return ret
}

/**
 * abi-encode the userOperation
 * @param op a PackedUserOp
 * @param forSignature "true" if the hash is needed to calculate the getUserOpHash()
 *  "false" to pack entire UserOp, for calculating the calldata cost of putting it on-chain.
 */
export function encodeUserOp (op1: NotPromise<PackedUserOperationStruct> | UserOperation, forSignature = true): string {
  // if "op" is unpacked UserOperation, then pack it first, before we ABI-encode it.
  let op: NotPromise<PackedUserOperationStruct>
  if ((op1 as any).callGasLimit != null) {
    op = packUserOp(op1 as UserOperation)
  } else {
    op = op1 as NotPromise<PackedUserOperationStruct>
  }
  if (forSignature) {
    return defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes32', 'bytes32',
        'bytes32', 'uint256', 'uint256', 'uint256',
        'bytes32'],
      [op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData),
        op.accountGasLimits, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas,
        keccak256(op.paymasterAndData)])
  } else {
    // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
    return defaultAbiCoder.encode(
      ['address', 'uint256', 'bytes', 'bytes',
        'bytes32', 'uint256', 'uint256', 'uint256',
        'bytes', 'bytes'],
      [op.sender, op.nonce, op.initCode, op.callData,
        op.accountGasLimits, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas,
        op.paymasterAndData, op.signature])
  }
}

/**
 * calculate the userOpHash of a given userOperation.
 * The userOpHash is a hash of all UserOperation fields, except the "signature" field.
 * The entryPoint uses this value in the emitted UserOperationEvent.
 * A wallet may use this value as the hash to sign (the SampleWallet uses this method)
 * @param op
 * @param entryPoint
 * @param chainId
 */
export function getUserOpHash (op: PackedUserOperation, entryPoint: string, chainId: number): string {
  const userOpHash = keccak256(encodeUserOp(op, true))
  const enc = defaultAbiCoder.encode(
    ['bytes32', 'address', 'uint256'],
    [userOpHash, entryPoint, chainId])
  return keccak256(enc)
}

const ErrorSig = keccak256(Buffer.from('Error(string)')).slice(0, 10) // 0x08c379a0
const FailedOpSig = keccak256(Buffer.from('FailedOp(uint256,string)')).slice(0, 10) // 0x220266b6

interface DecodedError {
  message: string
  opIndex?: number
}

/**
 * decode bytes thrown by revert as Error(message) or FailedOp(opIndex,paymaster,message)
 */
export function decodeErrorReason (error: string | Error): DecodedError | undefined {
  if (typeof error !== 'string') {
    const err = error as any
    error = (err.data ?? err.error.data) as string
  }

  debug('decoding', error)
  if (error.startsWith(ErrorSig)) {
    const [message] = defaultAbiCoder.decode(['string'], '0x' + error.substring(10))
    return { message }
  } else if (error.startsWith(FailedOpSig)) {
    let [opIndex, message] = defaultAbiCoder.decode(['uint256', 'string'], '0x' + error.substring(10))
    message = `FailedOp: ${message as string}`
    return {
      message,
      opIndex
    }
  }
}

/**
 * update thrown Error object with our custom FailedOp message, and re-throw it.
 * updated both "message" and inner encoded "data"
 * tested on geth, hardhat-node
 * usage: entryPoint.handleOps().catch(decodeError)
 */
export function rethrowError (e: any): any {
  let error = e
  let parent = e
  if (error?.error != null) {
    error = error.error
  }
  while (error?.data != null) {
    parent = error
    error = error.data
  }
  const decoded = typeof error === 'string' && error.length > 2 ? decodeErrorReason(error) : undefined
  if (decoded != null) {
    e.message = decoded.message

    if (decoded.opIndex != null) {
      // helper for chai: convert our FailedOp error into "Error(msg)"
      const errorWithMsg = hexConcat([ErrorSig, defaultAbiCoder.encode(['string'], [decoded.message])])
      // modify in-place the error object:
      parent.data = errorWithMsg
    }
  }
  throw e
}

/**
 * hexlify all members of object, recursively
 * @param obj
 */
export function deepHexlify (obj: any): any {
  if (typeof obj === 'function') {
    return undefined
  }
  if (obj == null || typeof obj === 'string' || typeof obj === 'boolean') {
    return obj
  } else if (obj._isBigNumber != null || typeof obj !== 'object') {
    return hexlify(obj).replace(/^0x0/, '0x')
  }
  if (Array.isArray(obj)) {
    return obj.map(member => deepHexlify(member))
  }
  return Object.keys(obj)
    .reduce((set, key) => ({
      ...set,
      [key]: deepHexlify(obj[key])
    }), {})
}

// resolve all property and hexlify.
// (UserOpMethodHandler receives data from the network, so we need to pack our generated values)
export async function resolveHexlify (a: any): Promise<any> {
  return deepHexlify(await resolveProperties(a))
}
