import { UserOperation } from '@account-abstraction/utils'
import { BigNumberish, BytesLike } from 'ethers'

/**
 * returned paymaster parameters.
 * note that if a paymaster is specified, then the gasLimits must be specified
 * (even if postOp is not called, the paymasterPostOpGasLimit must be set to zero)
 */
export interface PaymasterParams {
  paymaster: string
  paymasterData?: BytesLike
  paymasterVerificationGasLimit: BigNumberish
  paymasterPostOpGasLimit: BigNumberish
}

/**
 * an API to external a UserOperation with paymaster info
 */
export class PaymasterAPI {
  /**
   * return temporary values to put into the paymaster fields.
   * @param userOp the partially-filled UserOperation. Should be filled with tepmorary values for all
   *    fields except paymaster fields.
   * @return temporary paymaster parameters, that can be used for gas estimations
   */
  async getTemporaryPaymasterData (userOp: Partial<UserOperation>): Promise<PaymasterParams | null> {
    return null
  }

  /**
   * after gas estimation, return final paymaster parameters to replace the above tepmorary value.
   * @param userOp a partially-filled UserOperation (without signature and paymasterAndData
   *  note that the "preVerificationGas" is incomplete: it can't account for the
   *  paymasterAndData value, which will only be returned by this method..
   * @returns the values to put into paymaster fields, null to leave them empty
   */
  async getPaymasterData (userOp: Partial<UserOperation>): Promise<PaymasterParams | null> {
    return null
  }
}
