import { BigNumberish, Event } from 'ethers'
import { TransactionReceipt } from '@ethersproject/providers'

import { EntryPoint } from '@erc4337/common/dist/src/types'

/**
 * This class encapsulates Ethers.js listener function and necessary UserOperation details to
 * discover a TransactionReceipt for the operation.
 */
export class UserOperationEventListener {
  resolved: boolean = false
  listenerBind: (this: any, ...param: any) => Promise<void>

  constructor (
    readonly resolve: (t: TransactionReceipt) => void,
    readonly reject: (reason?: any) => void,
    readonly entryPoint: EntryPoint,
    readonly sender: string,
    readonly requestId: string,
    readonly nonce?: BigNumberish
  ) {
    console.log('requestId', this.requestId)
    this.listenerBind = this.listenerCallback.bind(this)
  }

  start (): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.entryPoint.on('UserOperationEvent', this.listenerBind) // TODO: i am 90% sure i don't need to bind it again
  }

  stop (): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.entryPoint.off('UserOperationEvent', this.listenerBind)
  }

  async listenerCallback (this: any, ...param: any): Promise<void> {
    const event = arguments[arguments.length - 1] as Event
    if (event.args == null) {
      console.error('got event without args', event)
      return
    }
    if (event.args.requestId !== this.requestId) {
      console.log(`== event with wrong requestId: sender/nonce: event.${event.args.sender as string}@${event.args.nonce.toString() as string}!= userOp.${this.sender as string}@${parseInt(this.nonce?.toString())}`)
      return
    }

    const transactionReceipt = await event.getTransactionReceipt()
    console.log('got event with status=', event.args.success, 'gasUsed=', transactionReceipt.gasUsed)

    // before returning the receipt, update the status from the event.
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (!event.args.success) {
      await this.extractFailureReason(transactionReceipt)
    }
    this.stop()
    this.resolve(transactionReceipt)
    this.resolved = true
  }

  async extractFailureReason (receipt: TransactionReceipt): Promise<void> {
    console.log('mark tx as failed')
    receipt.status = 0
    const revertReasonEvents = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationRevertReason(this.requestId, this.sender), receipt.blockHash)
    if (revertReasonEvents[0] != null) {
      console.log(`rejecting with reason: ${revertReasonEvents[0].args.revertReason}`)
      this.reject(new Error(`UserOp failed with reason: ${revertReasonEvents[0].args.revertReason}`)
      )
    }
  }
}
