import { UserOperationStruct } from '@account-abstraction/contracts'

export class PaymasterAPI {
  async getPaymasterAndData (userOp: Partial<UserOperationStruct>): Promise<string> {
    return '0x'
  }
}
