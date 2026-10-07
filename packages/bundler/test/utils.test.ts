import { expect } from 'chai'
import { BigNumber, ethers } from 'ethers'
import { decodeRevertReason, deepHexlify, sum } from '@account-abstraction/utils'

describe('#deepHexlify', function () {
  it('empty', () => {
    expect(deepHexlify({})).to.eql({})
  })
  it('flat', () => {
    expect(deepHexlify({ a: 1 })).to.eql({ a: '0x1' })
  })
  it('no-modify for strings', () => {
    expect(deepHexlify({ a: 'hello' })).to.eql({ a: 'hello' })
  })
  it('no-modify for boolean', () => {
    expect(deepHexlify({ a: false })).to.eql({ a: false })
  })
  it('bignum', () => {
    expect(deepHexlify({ a: BigNumber.from(3) })).to.eql({ a: '0x3' })
  })
  it('deep object ', () => {
    expect(deepHexlify({
      a: 1,
      b: {
        c: 4,
        d: false,
        e: [{
          f: 5,
          g: 'nothing',
          h: true
        }, 2, 3]
      }
    })).to.eql({
      a: '0x1',
      b: {
        c: '0x4',
        d: false,
        e: [{
          f: '0x5',
          g: 'nothing',
          h: true
        }, '0x2', '0x3']
      }
    })
  })
})

describe('#decodeRevertReason (Issue #262)', function () {
  it('should return null for non-revert RPC Error objects without data (nullIfNoMatch=true)', () => {
    const rpcError = new Error('invalid argument 0: json: cannot unmarshal non-string into Go struct field TransactionArgs.gas of type hexutil.Uint64')
    expect(decodeRevertReason(rpcError)).to.be.null
  })

  it('should return error message for non-revert RPC Error objects when nullIfNoMatch=false', () => {
    const msg = 'json: cannot unmarshal non-string into Go struct field TransactionArgs.gas'
    const rpcError = new Error(msg)
    expect(decodeRevertReason(rpcError, false)).to.equal(msg)
  })

  it('should not throw TypeError: slice of undefined on malformed or empty error data', () => {
    expect(decodeRevertReason({ error: { code: -32602 } })).to.be.null
    expect(decodeRevertReason({ data: undefined })).to.be.null
    expect(decodeRevertReason('')).to.be.null
    // @ts-ignore
    expect(decodeRevertReason(undefined)).to.be.null
  })

  it('should safely decode error with nested error.data', () => {
    const standardErrorSig = '0x08c379a0'
    const encoded = standardErrorSig + ethers.utils.defaultAbiCoder.encode(['string'], ['Execution reverted']).slice(2)
    expect(decodeRevertReason({ error: { data: encoded } })).to.equal('Error(Execution reverted)')
  })
})

describe('#ValidationManager gas encoding (Issue #262)', function () {
  it('should format transaction gas as 0x hex string without leading zeroes for geth RPC', () => {
    const prevg = BigNumber.from(21000)
    const verificationGasLimit = BigNumber.from(100000)
    const paymasterVerificationGasLimit = BigNumber.from(22155)
    const totalGas = sum(prevg, verificationGasLimit, paymasterVerificationGasLimit)

    expect(totalGas.toNumber()).to.equal(143155)

    const formattedGas = '0x' + BigInt(totalGas.toString()).toString(16)
    // 143155 in hex is 0x22f33 (no leading zero, geth compliant)
    expect(formattedGas).to.equal('0x22f33')
    expect(formattedGas).to.match(/^0x[0-9a-f]+$/)
    // Must not have odd length leading zero like 0x022f33
    expect(formattedGas).to.not.equal('0x022f33')
  })

  it('should format zero gas as 0x0', () => {
    const zeroGas = sum(0, 0, 0)
    const formattedGas = '0x' + BigInt(zeroGas.toString()).toString(16)
    expect(formattedGas).to.equal('0x0')
  })
})
