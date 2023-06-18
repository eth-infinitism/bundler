import { AddressLike, BigNumberish, EventLog, TransactionReceipt, AbiCoder } from 'ethers'
import { EntryPoint } from '@account-abstraction/utils/dist/src/ContractTypes'
import Debug from 'debug'

const debug = Debug('aa.listener')

const DEFAULT_TRANSACTION_TIMEOUT: number = 10000

const defaultAbiCoder = AbiCoder.defaultAbiCoder()

/**
 * This class encapsulates Ethers.js listener function and necessary UserOperation details to
 * discover a TransactionReceipt for the operation.
 */
export class UserOperationEventListener {
  resolved: boolean = false
  boundListener: (this: any, ...param: any) => void

  constructor (
    readonly resolve: (t: TransactionReceipt | PromiseLike<TransactionReceipt>) => void,
    readonly reject: (reason?: any) => void,
    readonly entryPoint: EntryPoint,
    readonly sender: AddressLike,
    readonly userOpHash: string,
    readonly nonce?: BigNumberish,
    readonly timeout?: number
  ) {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.boundListener = this.listenerCallback.bind(this)
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
        void this.entryPoint.once(filter, this.boundListener)
      }
    }, 100)
  }

  stop (): void {
    void this.entryPoint.off('UserOperationEvent', this.boundListener)
  }

  async listenerCallback (this: any, ...param: any): Promise<void> {
    const event = arguments[arguments.length - 1] as EventLog
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
    const rcpt = transactionReceipt as any
    rcpt.hash = this.userOpHash
    // TODO: set also getter methods?
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
    // WTF: can we change readonly field:
    // @ts-ignore
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
