import { UserOperationStruct } from '@account-abstraction/contracts'
import { BigNumberish, utils, Signer } from 'ethers'
import { VerifyingPaymaster__factory, VerifyingPaymaster } from './typechain'

export interface PaymasterParams {
  paymaster: string
  paymasterOwner: Signer
}

export interface PaymasterOption {
  payToken: string
  valueOfEth: BigNumberish
  validUntil: BigNumberish
}

/**
 * an API to external a UserOperation with paymaster info
 */
export class PaymasterAPI {
  paymaster: VerifyingPaymaster
  paymasterOwner: Signer

  constructor (params: PaymasterParams) {
    this.paymaster = VerifyingPaymaster__factory.connect(params.paymaster, params.paymasterOwner)
    this.paymasterOwner = params.paymasterOwner
  }

  /**
   * @param userOp a partially-filled UserOperation (without signature and paymasterAndData
   *  note that the "preVerificationGas" is incomplete: it can't account for the
   *  paymasterAndData value, which will only be returned by this method..
   * @returns the value to put into the PaymasterAndData, undefined to leave it empty
   */
  async getPaymasterAndData (userOp: UserOperationStruct, paymasterOption: PaymasterOption): Promise<string | undefined> {
    const payToken = paymasterOption.payToken
    const valueOfEth = paymasterOption.valueOfEth
    const validUntil = paymasterOption.validUntil
    const packedData = utils.solidityPack(
      ['address', 'uint256', 'uint256'],
      [paymasterOption.payToken, valueOfEth, validUntil]
    )

    const newUserOp = {
      ...userOp,
      signature: '0x',
      paymasterAndData: '0x'
    }
    const hash = await this.paymaster.getHash(newUserOp, packedData)

    const sig = await this.paymasterOwner.signMessage(utils.arrayify(hash))
    const paymasterCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'uint256', 'bytes'],
      [payToken, valueOfEth, validUntil, sig]
    )
    return utils.hexConcat([this.paymaster.address, paymasterCalldata])
  }
}
