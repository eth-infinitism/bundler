import { defaultAbiCoder, hexConcat, keccak256 } from 'ethers/lib/utils'
import { UserOperationStruct } from '@account-abstraction/contracts'
import { abi as entryPointAbi } from '@account-abstraction/contracts/artifacts/IEntryPoint.json'
import { ethers } from 'ethers'

// UserOperation is the first parameter of simulateValidation
const UserOpType = entryPointAbi.find(entry => entry.name === 'simulateValidation')?.inputs[0]

// reverse "Deferrable" or "PromiseOrValue" fields
export type NotPromise<T> = {
  [P in keyof T]: Exclude<T[P], Promise<any>>
}

function encode (typevalues: Array<{ type: string, val: any }>, forSignature: boolean): string {
  const types = typevalues.map(typevalue => typevalue.type === 'bytes' && forSignature ? 'bytes32' : typevalue.type)
  const values = typevalues.map((typevalue) => typevalue.type === 'bytes' && forSignature ? keccak256(typevalue.val) : typevalue.val)
  return defaultAbiCoder.encode(types, values)
}

/**
 * pack the userOperation
 * @param op
 * @param forSignature "true" if the hash is needed to calculate the getRequestId()
 *  "false" to pack entire UserOp, for calculating the calldata cost of putting it on-chain.
 */
export function packUserOp (op: NotPromise<UserOperationStruct>, forSignature = true): string {
  if (forSignature) {
    // lighter signature scheme (must match UserOperation#pack): do encode a zero-length signature, but strip afterwards the appended zero-length value
    const userOpType = {
      components: [
        {
          type: 'address',
          name: 'sender'
        },
        {
          type: 'uint256',
          name: 'nonce'
        },
        {
          type: 'bytes',
          name: 'initCode'
        },
        {
          type: 'bytes',
          name: 'callData'
        },
        {
          type: 'uint256',
          name: 'callGasLimit'
        },
        {
          type: 'uint256',
          name: 'verificationGasLimit'
        },
        {
          type: 'uint256',
          name: 'preVerificationGas'
        },
        {
          type: 'uint256',
          name: 'maxFeePerGas'
        },
        {
          type: 'uint256',
          name: 'maxPriorityFeePerGas'
        },
        {
          type: 'bytes',
          name: 'paymasterAndData'
        },
        {
          type: 'bytes',
          name: 'signature'
        }
      ],
      name: 'userOp',
      type: 'tuple'
    }
    // console.log('hard-coded userOpType', userOpType)
    // console.log('from ABI userOpType', UserOpType)
    let encoded = defaultAbiCoder.encode([userOpType as any], [{
      ...op,
      signature: '0x'
    }])
    // remove leading word (total length) and trailing word (zero-length signature)
    encoded = '0x' + encoded.slice(66, encoded.length - 64)
    return encoded
  }
  const typevalues = (UserOpType as any).components.map((c: { name: keyof typeof op, type: string }) => ({
    type: c.type,
    val: op[c.name]
  }))
  // const typevalues = [
  //   {
  //     type: 'address',
  //     val: op.sender
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.nonce
  //   },
  //   {
  //     type: 'bytes',
  //     val: op.initCode
  //   },
  //   {
  //     type: 'bytes',
  //     val: op.callData
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.callGasLimit
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.verificationGasLimit
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.preVerificationGas
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.maxFeePerGas
  //   },
  //   {
  //     type: 'uint256',
  //     val: op.maxPriorityFeePerGas
  //   },
  //   {
  //     type: 'bytes',
  //     val: op.paymasterAndData
  //   }
  // ]
  // console.log('hard-coded typedvalues', typevalues)
  // console.log('from ABI typedValues', typedValues)
  if (!forSignature) {
    // for the purpose of calculating gas cost, also hash signature
    typevalues.push({
      type: 'bytes',
      val: op.signature
    })
  }
  return encode(typevalues, forSignature)
}

/**
 * calculate the requestId of a given userOperation.
 * The requestId is a hash of all UserOperation fields, except the "signature" field.
 * The entryPoint uses this value in the emitted UserOperationEvent.
 * A wallet may use this value as the hash to sign (the SampleWallet uses this method)
 * @param op
 * @param entryPoint
 * @param chainId
 */
export function getRequestId (op: NotPromise<UserOperationStruct>, entryPoint: string, chainId: number): string {
  const userOpHash = keccak256(packUserOp(op, true))
  const enc = defaultAbiCoder.encode(
    ['bytes32', 'address', 'uint256'],
    [userOpHash, entryPoint, chainId])
  return keccak256(enc)
}

const ErrorSig = keccak256(Buffer.from('Error(string)')).slice(0, 10) // 0x08c379a0
const FailedOpSig = keccak256(Buffer.from('FailedOp(uint256,address,string)')).slice(0, 10) // 0x00fa072b

interface DecodedError {
  message: string
  opIndex?: number
  paymaster?: string
}

/**
 * decode bytes thrown by revert as Error(message) or FailedOp(opIndex,paymaster,message)
 */
export function decodeErrorReason (error: string): DecodedError | undefined {
  console.log('decoding', error)
  if (error.startsWith(ErrorSig)) {
    const [message] = defaultAbiCoder.decode(['string'], '0x' + error.substring(10))
    return { message }
  } else if (error.startsWith(FailedOpSig)) {
    let [opIndex, paymaster, message] = defaultAbiCoder.decode(['uint256', 'address', 'string'], '0x' + error.substring(10))
    message = `FailedOp: ${message as string}`
    if (paymaster.toString() !== ethers.constants.AddressZero) {
      message = `${message as string} (paymaster ${paymaster as string})`
    } else {
      paymaster = undefined
    }
    return {
      message,
      opIndex,
      paymaster
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
