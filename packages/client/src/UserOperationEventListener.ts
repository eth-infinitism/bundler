import { Event } from 'ethers'
import { TransactionReceipt } from '@ethersproject/providers'

export class UserOperationEventListener {
  resolved: boolean = false

  constructor (
    readonly resolve: any,
    readonly reject: any,
    readonly entryPoint: any,
    readonly sender: any,
    readonly nonce: any,
    readonly requestId: any
  ) {}

  async listener (this: any, ...param: any): Promise<void> {
    // if (resolved) return
    const event = arguments[arguments.length - 1] as Event
    // if (event.blockNumber <= await currentBLock) {
    //   // not sure why this callback is called first for previously-mined block..
    //   console.log('ignore previous block', event.blockNumber)
    //   return
    // }
    if (event.args == null) {
      console.error('got event without args', event)
      return
    }
    if (event.args.requestId !== this.requestId) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions,@typescript-eslint/no-base-to-string
      console.log(`== event with wrong requestId: sender/nonce: event.${event.args.sender}@${event.args.nonce.toString()}!= userOp.${this.sender}@${parseInt(this.nonce.toString())}`)
      return
    }

    const rcpt = await event.getTransactionReceipt()
    console.log('got event with status=', event.args.success, 'gasUsed=', rcpt.gasUsed)

    // TODO: should use "requestId" as "transactionId" (but this has to be done in a provider, not a signer)

    // before returning the receipt, update the status from the event.
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!event.args.success) {
      await this.extractFailureReason(rcpt)
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.entryPoint.off('UserOperationEvent', this.listener)
    this.resolve(rcpt)
    this.resolved = true
  }

  async extractFailureReason (receipt: TransactionReceipt): Promise<void> {
    console.log('mark tx as failed')
    receipt.status = 0
    const revertReasonEvents = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationRevertReason(this.requestId, this.sender), receipt.blockHash)
    if (revertReasonEvents[0] != null) {
      console.log('rejecting with reason')
      this.reject(new Error(`UserOp failed with reason: ${revertReasonEvents[0].args.revertReason as string}`)
      )
    }
  }
}
