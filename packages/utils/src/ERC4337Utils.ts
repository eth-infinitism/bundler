import {
  defaultAbiCoder,
  hexConcat, hexDataLength,
  hexDataSlice,
  hexlify,
  hexZeroPad,
  keccak256,
  resolveProperties
} from 'ethers/lib/utils'
import { abi as entryPointAbi } from '@account-abstraction/contracts/artifacts/IEntryPoint.json'

import { BigNumber, BigNumberish, BytesLike, ethers, TypedDataDomain, TypedDataField } from 'ethers'
import { EIP_7702_MARKER_INIT_CODE, PackedUserOperation } from './Utils'
import { UserOperation } from './interfaces/UserOperation'

// UserOperation is the first parameter of getUserOpHash
const getUserOpHashMethod = 'getUserOpHash'
const PackedUserOpType = entryPointAbi.find(entry => entry.name === getUserOpHashMethod)?.inputs[0]
if (PackedUserOpType == null) {
  throw new Error(`unable to find method ${getUserOpHashMethod} in EP ${entryPointAbi.filter(x => x.type === 'function').map(x => x.name).join(',')}`)
}

export const AddressZero = ethers.constants.AddressZero

// Matched to domain name, version from EntryPoint.sol:
const DOMAIN_NAME = 'ERC4337'
const DOMAIN_VERSION = '1'

// Matched to UserOperationLib.sol:
const PACKED_USEROP_TYPEHASH = keccak256(Buffer.from('PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)'))

// reverse "Deferrable" or "PromiseOrValue" fields
export type NotPromise<T> = {
  [P in keyof T]: Exclude<T[P], Promise<any>>
}

// todo: remove this wrapper method?
export function packAccountGasLimits (validationGasLimit: BigNumberish, callGasLimit: BigNumberish): string {
  return packUint(validationGasLimit, callGasLimit)
}

export function unpackAccountGasLimits (accountGasLimits: BytesLike): {
  verificationGasLimit: BigNumber
  callGasLimit: BigNumber
} {
  const [verificationGasLimit, callGasLimit] = unpackUint(accountGasLimits)
  return {
    verificationGasLimit,
    callGasLimit
  }
}

export function packUint (high128: BigNumberish, low128: BigNumberish): string {
  return hexZeroPad(BigNumber.from(high128).shl(128).add(low128).toHexString(), 32)
}

export function unpackUint (packed: BytesLike): [high128: BigNumber, low128: BigNumber] {
  const packedNumber: BigNumber = BigNumber.from(packed)
  return [packedNumber.shr(128), packedNumber.and(BigNumber.from(1).shl(128).sub(1))]
}

export function packPaymasterData (paymaster: string, paymasterVerificationGasLimit: BigNumberish, postOpGasLimit: BigNumberish, paymasterData?: BytesLike): BytesLike {
  return ethers.utils.hexConcat([
    paymaster,
    packUint(paymasterVerificationGasLimit, postOpGasLimit),
    paymasterData ?? '0x'
  ])
}

export interface ValidationData {
  aggregator: string
  validAfter: number
  validUntil: number
}

export const maxUint48 = (2 ** 48) - 1
export const SIG_VALIDATION_FAILED = hexZeroPad('0x01', 20)

/**
 * parse validationData as returned from validateUserOp or validatePaymasterUserOp into ValidationData struct
 * @param validationData
 */
export function parseValidationData (validationData: BigNumberish): ValidationData {
  const data = hexZeroPad(BigNumber.from(validationData).toHexString(), 32)

  // string offsets start from left (msb)
  const aggregator = hexDataSlice(data, 32 - 20)
  let validUntil = parseInt(hexDataSlice(data, 32 - 26, 32 - 20))
  if (validUntil === 0) validUntil = maxUint48
  const validAfter = parseInt(hexDataSlice(data, 0, 6))

  return {
    aggregator,
    validAfter,
    validUntil
  }
}

export function mergeValidationDataValues (accountValidationData: BigNumberish, paymasterValidationData: BigNumberish): ValidationData {
  return mergeValidationData(
    parseValidationData(accountValidationData),
    parseValidationData(paymasterValidationData)
  )
}

/**
 * merge validationData structure returned by paymaster and account
 * @param accountValidationData returned from validateUserOp
 * @param paymasterValidationData returned from validatePaymasterUserOp
 */
export function mergeValidationData (accountValidationData: ValidationData, paymasterValidationData: ValidationData): ValidationData {
  return {
    aggregator: paymasterValidationData.aggregator !== AddressZero ? SIG_VALIDATION_FAILED : accountValidationData.aggregator,
    validAfter: Math.max(accountValidationData.validAfter, paymasterValidationData.validAfter),
    validUntil: Math.min(accountValidationData.validUntil, paymasterValidationData.validUntil)
  }
}

export function packValidationData (validationData: ValidationData): BigNumber {
  return BigNumber.from(validationData.validAfter ?? 0).shl(48)
    .add(validationData.validUntil ?? 0).shl(160)
    .add(validationData.aggregator)
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
  const [paymasterVerificationGas, postOpGasLimit] = unpackUint(hexDataSlice(paymasterAndData, 20, 52))
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
  let initCode = op.factory == null ? '0x' : hexConcat([op.factory, op.factoryData ?? '0x'])
  if (op.factory === EIP_7702_MARKER_INIT_CODE) {
    const eip7702FlagInitCode = EIP_7702_MARKER_INIT_CODE.padEnd(42, '0')
    initCode = hexConcat([eip7702FlagInitCode, op.factoryData ?? '0x'])
  }
  return {
    sender: op.sender,
    nonce: BigNumber.from(op.nonce).toHexString(),
    initCode,
    callData: op.callData,
    accountGasLimits: packUint(op.verificationGasLimit, op.callGasLimit),
    preVerificationGas: BigNumber.from(op.preVerificationGas).toHexString(),
    gasFees: packUint(op.maxPriorityFeePerGas, op.maxFeePerGas),
    paymasterAndData,
    signature: op.signature
  }
}

export function unpackUserOp (packed: PackedUserOperation): UserOperation {
  const [verificationGasLimit, callGasLimit] = unpackUint(packed.accountGasLimits)
  const [maxPriorityFeePerGas, maxFeePerGas] = unpackUint(packed.gasFees)

  let ret: UserOperation = {
    sender: packed.sender,
    nonce: packed.nonce,
    callData: packed.callData,
    preVerificationGas: packed.preVerificationGas,
    verificationGasLimit,
    callGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: packed.signature
  }
  if (packed.initCode != null && packed.initCode.length > 2) {
    const factory = hexDataSlice(packed.initCode, 0, 20)
    const factoryData = hexDataSlice(packed.initCode, 20)
    ret = {
      ...ret,
      factory,
      factoryData
    }
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
 * @param unpackedUserOperation an unpacked UserOperation object
 * @param forSignature "true" if the hash is needed to calculate the getUserOpHash()
 *  "false" to pack entire UserOp, for calculating the calldata cost of putting it on-chain.
 */
export function encodeUserOp (unpackedUserOperation: UserOperation, forSignature = true): string {
  // if "op" is unpacked UserOperation, then pack it first, before we ABI-encode it.
  const op: PackedUserOperation = packUserOp(unpackedUserOperation)
  if (forSignature) {
    return defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256', 'bytes32', 'bytes32',
        'bytes32', 'uint256', 'bytes32',
        'bytes32'],
      [PACKED_USEROP_TYPEHASH,
        op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData),
        op.accountGasLimits, op.preVerificationGas, op.gasFees,
        keccak256(op.paymasterAndData)])
  } else {
    // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
    return defaultAbiCoder.encode(
      ['bytes32', 'address', 'uint256', 'bytes', 'bytes',
        'bytes32', 'uint256', 'bytes32',
        'bytes', 'bytes'],
      [PACKED_USEROP_TYPEHASH,
        op.sender, op.nonce, op.initCode, op.callData,
        op.accountGasLimits, op.preVerificationGas, op.gasFees,
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
export function getUserOpHash (op: UserOperation, entryPoint: string, chainId: number): string {
  const packed = encodeUserOp(op, true)
  return keccak256(hexConcat([
    '0x1901',
    getDomainSeparator(entryPoint, chainId),
    keccak256(packed)
  ]))
}

export function getDomainSeparator (entryPoint: string, chainId: number): string {
  const domainData = getErc4337TypedDataDomain(entryPoint, chainId) as Required<TypedDataDomain>
  return keccak256(defaultAbiCoder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
    [
      keccak256(Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(Buffer.from(domainData.name)),
      keccak256(Buffer.from(domainData.version)),
      domainData.chainId,
      domainData.verifyingContract
    ]))
}

export function getErc4337TypedDataDomain (entryPoint: string, chainId: number): TypedDataDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: entryPoint
  }
}

export function getErc4337TypedDataTypes (): { [type: string]: TypedDataField[] } {
  return {
    PackedUserOperation: [
      { name: 'sender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'initCode', type: 'bytes' },
      { name: 'callData', type: 'bytes' },
      { name: 'accountGasLimits', type: 'bytes32' },
      { name: 'preVerificationGas', type: 'uint256' },
      { name: 'gasFees', type: 'bytes32' },
      { name: 'paymasterAndData', type: 'bytes' }
    ]
  }
}

export const ErrorSig = keccak256(Buffer.from('Error(string)')).slice(0, 10) // 0x08c379a0
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
    error = (err.data ?? err.error?.data ?? err.message) as string
  }

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
