import { expect } from 'chai'
import { hexlify } from 'ethers/lib/utils'
import { calcPreVerificationGas } from '../src/calcPreVerificationGas'

describe('#calcPreVerificationGas', () => {
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

  it('returns a gas value proportional to sigSize', async () => {
    const pvg1 = calcPreVerificationGas(userOp, { sigSize: 0 })
    const pvg2 = calcPreVerificationGas(userOp, { sigSize: 65 })

    expect(pvg2).to.be.greaterThan(pvg1)
  })

  it('returns a gas value that ignores sigSize if userOp already signed', async () => {
    const userOpWithSig = {
      ...userOp,
      signature: hexlify(Buffer.alloc(65, 1))
    }

    const pvg1 = calcPreVerificationGas(userOpWithSig, { sigSize: 0 })
    const pvg2 = calcPreVerificationGas(userOpWithSig)
    expect(pvg2).to.equal(pvg1)
  })
})
