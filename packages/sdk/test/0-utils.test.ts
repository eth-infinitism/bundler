import { expect } from 'chai'
import {
  packAccountGasLimits,
  packPaymasterData, packUint,
  packUserOp,
  unpackAccountGasLimits,
  unpackPaymasterAndData
} from '@account-abstraction/utils'
import { hexConcat, hexlify, hexZeroPad } from 'ethers/lib/utils'
import { BigNumber } from 'ethers'

describe('utils', () => {
  describe('userop pack/unpack functions', () => {
    const paymaster = '0xaa'.padEnd(42, 'a')

    it('#packAccountGasLimits', function () {
      expect(packAccountGasLimits(0xaa, 0xbbbb)).to.eql(
        hexConcat([hexZeroPad('0xaa', 16), hexZeroPad('0xbbbb', 16)])
      )
    })
    it('#unpackAccountGasLimits', function () {
      const packed = hexConcat([hexZeroPad('0xaa', 16), hexZeroPad('0xbbbb', 16)])
      expect(unpackAccountGasLimits(packed))
        .to.eql({ verificationGasLimit: BigNumber.from(0xaa), callGasLimit: BigNumber.from(0xbbbb) })
    })
    it('#packPaymasterAndData', () => {
      const pmVerificationGas = 1
      const postOpGas = 2
      expect(packPaymasterData(paymaster, pmVerificationGas, postOpGas))
        .to.eql(hexConcat([
          paymaster,
          hexZeroPad(hexlify(pmVerificationGas), 16),
          hexZeroPad(hexlify(postOpGas), 16)
        ]))

      const pmData = '0xdeadface'
      expect(packPaymasterData(paymaster, pmVerificationGas, postOpGas, pmData))
        .to.eql(hexConcat([
          paymaster,
          hexZeroPad(hexlify(pmVerificationGas), 16),
          hexZeroPad(hexlify(postOpGas), 16),
          pmData
        ]))
    })
    it('#packPaymasterAndData', () => {
      const paymasterVerificationGas = BigNumber.from(1)
      const postOpGasLimit = BigNumber.from(2)
      expect(unpackPaymasterAndData(packPaymasterData(paymaster, paymasterVerificationGas, postOpGasLimit)))
        .to.eql({ paymaster, paymasterVerificationGas, postOpGasLimit, paymasterData: '0x' })

      const paymasterData = '0xbeaf'
      expect(unpackPaymasterAndData(packPaymasterData(paymaster, paymasterVerificationGas, postOpGasLimit, paymasterData)))
        .to.eql({ paymaster, paymasterVerificationGas, postOpGasLimit, paymasterData })
    })

    it('should pack userop without optional fields', function () {
      expect(packUserOp({
        sender: 'a',
        nonce: 1,
        callGasLimit: 2,
        verificationGasLimit: 3,
        preVerificationGas: 4,
        callData: '333',
        maxFeePerGas: 5,
        maxPriorityFeePerGas: 6,
        signature: '777'
      })).to.eql({
        sender: 'a',
        nonce: '0x01',
        initCode: '0x',
        accountGasLimits: packAccountGasLimits(3, 2),
        preVerificationGas: '0x04',
        callData: '333',
        gasFees: packUint(6, 5),
        signature: '777',
        paymasterAndData: '0x'
      })
    })

    it('should pack userop with optional fields', function () {
      const factory = '0xfa'.padEnd(42, 'fa')
      expect(packUserOp({
        sender: 'a',
        nonce: 1,
        factory,
        factoryData: '0xbeaf',
        callGasLimit: 2,
        verificationGasLimit: 3,
        preVerificationGas: 4,
        callData: '333',
        maxFeePerGas: 5,
        maxPriorityFeePerGas: 6,
        signature: '777',
        paymaster,
        paymasterVerificationGasLimit: 8,
        paymasterPostOpGasLimit: 9,
        paymasterData: '0xcafebabe'
      })).to.eql({
        sender: 'a',
        nonce: '0x01',
        initCode: hexConcat([factory, '0xbeaf']),
        accountGasLimits: packAccountGasLimits(3, 2),
        preVerificationGas: '0x04',
        gasFees: packUint(6, 5),
        callData: '333',
        signature: '777',
        paymasterAndData: hexConcat([
          paymaster,
          hexZeroPad('0x8', 16),
          hexZeroPad('0x9', 16),
          '0xcafebabe'
        ])
      })
    })
  })
})
