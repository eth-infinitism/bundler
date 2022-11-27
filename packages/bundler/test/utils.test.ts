import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { deepHexlify } from '../src/utils'

describe('#deepHexlify', function () {
  it('empty', () => {
    expect(deepHexlify({})).to.eql({})
  })
  it('flat', () => {
    expect(deepHexlify({ a: 1 })).to.eql({ a: '0x01' })
  })
  it('no-modify for strings', () => {
    expect(deepHexlify({ a: 'hello' })).to.eql({ a: 'hello' })
  })
  it('no-modify for boolean', () => {
    expect(deepHexlify({ a: false })).to.eql({ a: false })
  })
  it('bignum', () => {
    expect(deepHexlify({ a: BigNumber.from(3) })).to.eql({ a: '0x03' })
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
      a: '0x01',
      b: {
        c: '0x04',
        d: false,
        e: [{
          f: '0x05',
          g: 'nothing',
          h: true
        }, '0x02', '0x03']
      }
    })
  })
})
