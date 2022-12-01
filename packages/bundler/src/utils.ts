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
