import { BigNumberish, Event } from 'ethers'
import { TransactionReceipt } from '@ethersproject/providers'
import { defaultAbiCoder } from 'ethers/lib/utils'
import Debug from 'debug'
import { IEntryPoint } from '@account-abstraction/utils'

const debug = Debug('aa.listener')

const DEFAULT_TRANSACTION_TIMEOUT: number = 10000

/**
 * This class encapsulates Ethers.js listener function and necessary UserOperation details to
 * discover a TransactionReceipt for the operation.
 */
export class UserOperationEventListener {
  resolved: boolean = false
  boundLisener: (this: any, ...param: any) => void

  constructor (
    readonly resolve: (t: TransactionReceipt) => void,
    readonly reject: (reason?: any) => void,
    readonly entryPoint: IEntryPoint,
    readonly sender: string,
    readonly userOpHash: string,
    readonly nonce?: BigNumberish,
    readonly timeout?: number
  ) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.boundLisener = this.listenerCallback.bind(this)
    setTimeout(() => {
      this.stop()
      this.reject(new Error('Timed out'))
    }, this.timeout ?? DEFAULT_TRANSACTION_TIMEOUT)
  }

  start (): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const filter = this.entryPoint.filters.UserOperationEvent(this.userOpHash)
    // listener takes time... first query directly:
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      const res = await this.entryPoint.queryFilter(filter, 'latest')
      if (res.length > 0) {
        void this.listenerCallback(res[0])
      } else {
        this.entryPoint.once(filter, this.boundLisener)
      }
    }, 100)
  }

  stop (): void {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.entryPoint.off('UserOperationEvent', this.boundLisener)
  }

  async listenerCallback (this: any, ...param: any): Promise<void> {
    const event = arguments[arguments.length - 1] as Event
    if (event.args == null) {
      console.error('got event without args', event)
      return
    }
    // TODO: can this happen? we register to event by userOpHash..
    if (event.args.userOpHash !== this.userOpHash) {
      console.log(`== event with wrong userOpHash: sender/nonce: event.${event.args.sender as string}@${event.args.nonce.toString() as string}!= userOp.${this.sender as string}@${parseInt(this.nonce?.toString())}`)
      return
    }

    const transactionReceipt = await event.getTransactionReceipt()
    transactionReceipt.transactionHash = this.userOpHash
    debug('got event with status=', event.args.success, 'gasUsed=', transactionReceipt.gasUsed)

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
    debug('mark tx as failed')
    receipt.status = 0
    const revertReasonEvents = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationRevertReason(this.userOpHash, this.sender), receipt.blockHash)
    if (revertReasonEvents[0] != null) {
      let message = revertReasonEvents[0].args.revertReason
      if (message.startsWith('0x08c379a0')) {
        // Error(string)
        message = defaultAbiCoder.decode(['string'], '0x' + message.substring(10)).toString()
      }
      debug(`rejecting with reason: ${message}`)
      this.reject(new Error(`UserOp failed with reason: ${message}`)
      )
    }
  }
}
