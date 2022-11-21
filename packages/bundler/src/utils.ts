import { hexlify } from 'ethers/lib/utils'

/**
 * hexlify all members of object, recursively
 * @param obj
 */
export function deepHexlify (obj: any): any {
  if (obj == null || typeof obj == 'string' || typeof obj == 'boolean') {
    return obj
  } else if (obj._isBigNumber || typeof obj != 'object') {
    return hexlify(obj)
  }
  if (Array.isArray(obj)) {
    return obj.map(member => deepHexlify(member))
  }
  return Object.keys(obj).map(key => [key, deepHexlify(obj[key])])
    .reduce((set, [key, val]) => ({
      ...set,
      [key]: val
    }), {})
}

export class RpcError extends Error {
  constructor (msg: string, readonly code?: number, readonly data: any = undefined) {
    super(msg)
  }
}

export function requireCond (cond: boolean, msg: string, code?: number, data: any = undefined) {
  if (!cond) throw new RpcError(msg, code, data)
}
