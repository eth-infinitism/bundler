import fs from 'fs'

export class RpcError extends Error {
  // error codes from: https://eips.ethereum.org/EIPS/eip-1474
  constructor (msg: string, readonly code?: number, readonly data: any = undefined) {
    super(msg)
  }
}

export function requireCond (cond: boolean, msg: string, code?: number, data: any = undefined): void {
  if (!cond) {
    throw new RpcError(msg, code, data)
  }
}

let gSigs: any = null
let gSigsRegex: RegExp = null as any

// debug:
export function replaceMethodSig (s: string): string {
  if (gSigs == null) {
    gSigs = {}
    if (!fs.existsSync('/tmp/hashes.txt')) {
      return s
    }
    const hashes = fs.readFileSync('/tmp/hashes.txt', 'ascii')
    hashes.split(/\n/).forEach(hash => {
      const m = hash.match(/(\w+): (\w+)[(]/)
      if (m != null) {
        gSigs['0x' + m[1]] = m[2]
      }
    })
    gSigsRegex = new RegExp('(' + Object.keys(gSigs).join('|') + ')', 'g')
  }

  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  return s.replace(gSigsRegex, substr => `${gSigs[substr]} - ${substr}`)
}

/**
 * create a dictionary object with given keys
 * @param keys the property names of the returned object
 * @param mapper mapper from key to property value
 * @param filter if exists, must return true to add keys
 */
export function mapOf<T> (keys: Iterable<string>, mapper: (key: string) => T, filter?: (key: string) => boolean): { [key: string]: T } {
  const ret: { [key: string]: T } = {}
  for (const key of keys) {
    if (filter == null || filter(key)) {
      ret[key] = mapper(key)
    }
  }
  return ret
}
