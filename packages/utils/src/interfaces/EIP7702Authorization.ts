import { BigNumberish } from 'ethers'
import RLP from 'rlp'
import { bytesToHex, ecrecover, hexToBigInt, hexToBytes, PrefixedHexString, pubToAddress } from '@ethereumjs/util'
import { AddressZero } from '../ERC4337Utils'
import { keccak256 } from '@ethersproject/keccak256'
import { toChecksumAddress } from 'ethereumjs-util'

export interface EIP7702Authorization {
  chainId: BigNumberish
  address: string
  nonce: BigNumberish
  yParity: BigNumberish
  r: BigNumberish
  s: BigNumberish
}

export function toRlpHex (s: any): PrefixedHexString {
  // remove leading zeros (also, 0x0 returned as 0x)
  return s.toString().replace(/0x0*/, '0x') as PrefixedHexString
}

export function getEip7702AuthorizationSigner (authorization: EIP7702Authorization): string {
  const rlpEncode = [
    5,
    ...RLP.encode(
      [
        toRlpHex(authorization.chainId),
        toRlpHex(authorization.address),
        toRlpHex(authorization.nonce)
      ]
    )
  ]
  const messageHash = keccak256(rlpEncode) as `0x${string}`
  const senderPubKey = ecrecover(
    hexToBytes(messageHash),
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    hexToBigInt(authorization.yParity.toString() as `0x${string}`),
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    hexToBytes(authorization.r.toString() as `0x${string}`),
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    hexToBytes(authorization.s.toString() as `0x${string}`)
  )
  const sender = toChecksumAddress(bytesToHex(pubToAddress(senderPubKey)))
  if (sender === AddressZero) {
    throw new Error(`Failed to recover authorization for address ${authorization.address}`)
  }
  return sender
}
