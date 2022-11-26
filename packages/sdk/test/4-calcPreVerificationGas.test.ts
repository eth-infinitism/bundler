import { expect } from 'chai'
import { calcPreVerificationGas } from '../src/calcPreVerificationGas'

describe('#calcPreVerificationGas', () => {
  it('returns a gas value proportional to sigSize', async () => {
    const userOp = {
      sender: '0x'.padEnd(42, '1'),
      nonce: 0,
      initCode: '0x3333',
      callData: '0x4444',
      callGasLimit: 5,
      verificationGasLimit: 6,
      maxFeePerGas: 8,
      maxPriorityFeePerGas: 9,
      paymasterAndData: '0xaaaaaa'
    }

    const pvg1 = calcPreVerificationGas(userOp, undefined, 0)
    const pvg2 = calcPreVerificationGas(userOp, undefined, 65)
    expect(pvg2).to.be.greaterThan(pvg1)
  })
})
