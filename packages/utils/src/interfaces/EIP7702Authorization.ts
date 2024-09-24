import { BigNumberish } from 'ethers'
import RLP from 'rlp'
import { toHex } from 'hardhat/internal/util/bigint'
import { hashMessage, hexlify } from 'ethers/lib/utils'
import { bytesToHex, ecrecover, hexToBytes, pubToAddress } from '@ethereumjs/util'
import { AddressZero } from '../ERC4337Utils'
import { keccak256 } from '@ethersproject/keccak256'

export interface EIP7702Authorization {
  chainId: BigNumberish,
  address: string,
  nonce: BigNumberish,
  yParity: BigNumberish,
  r: BigNumberish,
  s: BigNumberish
}

export function getEip7702AuthorizationSigner (authorization: EIP7702Authorization): string {
  const rlpEncode = [
    5,
    ...RLP.encode(
      [
        authorization.chainId.toString(),
        authorization.address.toString(),
        authorization.nonce.toString()
      ]
    )
  ]
  const messageHash = keccak256(rlpEncode) as `0x${string}`
  console.log(hexlify(rlpEncode))
  console.log(messageHash)
  const senderPubKey = ecrecover(
    hexToBytes(messageHash),
    BigInt(authorization.yParity.toString()),
    hexToBytes(authorization.r.toString() as `0x${string}`),
    hexToBytes(authorization.s.toString() as `0x${string}`)
  )
  const sender = bytesToHex(pubToAddress(senderPubKey))
  if (sender === AddressZero) {
    throw new Error(`Failed to recover authorization for address ${authorization.address}`)
  }
  return sender
}
