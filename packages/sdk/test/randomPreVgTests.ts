import { EXECUTE_USEROP_METHOD_SIG, PreVgChecker } from './PreVgChecker'
import { JsonRpcProvider } from '@ethersproject/providers'

// @ts-ignore
async function main (): Promise<void> {
  await randomPreVgTests(new JsonRpcProvider('http://localhost:8545'))
}

export async function randomPreVgTests (provider: JsonRpcProvider): Promise<void> {
  function random (min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }
  function boolRandom (): boolean {
    return Math.random() < 0.5
  }

  const c = new PreVgChecker(provider, { totalGasUsed: 1e7 })
  for (let i = 0; i < 100; i++) {
    const bundleSize = random(1, 20)
    const callDataSize = random(1, 8192)
    const useFactory = boolRandom()
    const factoryAppendSize = random(1, 1000)
    const sigSize = random(1, 2000)
    const pmDataSize = boolRandom() ? random(1, 4000) : undefined

    // limit total size..
    if (callDataSize + factoryAppendSize + (pmDataSize ?? 0) + sigSize > 10000) {
      i--
      continue
    }
    const callDataPrefix = boolRandom() ? EXECUTE_USEROP_METHOD_SIG : undefined
    const params = {
      bundleSize,
      callDataSize,
      useFactory,
      factoryAppendSize,
      sigSize,
      pmDataSize,
      callDataPrefix
    }
    console.log('random params', params)
    c.statsDict.reset()
    await c.checkPreVg(params)
    const diff = c.statsDict.get('diff')
    console.log('stats', diff.stats())
    // expect(diff.min).to.be.gt(0, diff.stats())
    // expect(diff.max! - diff.min!).to.be.lt(200, diff.stats())
  }
}
