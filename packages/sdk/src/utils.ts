import { hexValue } from 'ethers/lib/utils'

import * as constants from './constants'

export const getRpcUrl = (chainId: number): string => {
  return `https://${constants.CHAIN_ID_TO_INFURA_NAMES[chainId]}.infura.io/v3/${constants.INFURA_API_KEY}`
}

export const hexifyUserOp = (resolvedUserOp: any) => {
  return Object.keys(resolvedUserOp)
    .map((key) => {
      let val = (resolvedUserOp as any)[key]
      if (typeof val !== 'string' || !val.startsWith('0x')) {
        val = hexValue(val)
      }
      return [key, val]
    })
    .reduce(
      (set, [k, v]) => ({
        ...set,
        [k]: v,
      }),
      {}
    )
}
