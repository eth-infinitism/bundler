import { AddressLike, BigNumberish, EventLog, TransactionReceipt, AbiCoder } from 'ethers'
import { EntryPoint } from '@account-abstraction/utils/src/ContractTypes'
import Debug from 'debug'
import { ERC4337EthersProvider } from './ERC4337EthersProvider'
import {
  UserOperationEventEvent
} from '@account-abstraction/utils/dist/src/types/@account-abstraction/contracts/core/EntryPoint'
import { TransactionReceiptParams } from 'ethers/src.ts/providers/formatting'

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

  entryPoint: EntryPoint
  userOpEventFilter: UserOperationEventEvent.Filter

  constructor (
    readonly erc4337Provider: ERC4337EthersProvider,
    readonly resolve: (t: TransactionReceipt | PromiseLike<TransactionReceipt>) => void,
    readonly reject: (reason?: any) => void,
    readonly sender: AddressLike,
    readonly userOpHash: string,
    readonly nonce?: BigNumberish,
    readonly timeout?: number
  ) {
    this.entryPoint = erc4337Provider.entryPoint
    this.userOpEventFilter = this.entryPoint.filters.UserOperationEvent(this.userOpHash)

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.boundListener = this.listenerCallback.bind(this)
    setTimeout(() => {
      this.stop()
      this.reject(new Error('Timed out'))
    }, this.timeout ?? DEFAULT_TRANSACTION_TIMEOUT)
  }

  start (): void {
    debug('UserOperationEventListener.start')
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    // listener takes time... first query directly:
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      const res = await this.entryPoint.queryFilter(this.userOpEventFilter, 'latest')
      if (res.length > 0) {
        void this.listenerCallback(res[0])
      } else {
        void this.entryPoint.once(this.userOpEventFilter, this.boundListener)
      }
    }, 100)
  }

  stop (): void {
    debug('UserOperationEventListener.stop')

    void this.entryPoint.off('UserOperationEvent', this.boundListener)
  }

  async listenerCallback (this: any, ...param: any): Promise<void> {
    const event = arguments[arguments.length - 1] as EventLog
    if (event.args == null) {
      console.error('got event without args', event)
      return
    }
    debug('UserOperationEventListener.listenerCallback', event.eventName, event.args, event.transactionHash)
    // TODO: can this happen? we register to event by userOpHash..
    if (event.args.userOpHash !== this.userOpHash) {
      console.log(`== event with wrong userOpHash: sender/nonce: event.${event.args.sender as string}@${event.args.nonce.toString() as string}!= userOp.${this.sender as string}@${parseInt(this.nonce?.toString())}`)
      return
    }

    const transactionReceipt = await event.getTransactionReceipt()

    const rcpt = new TransactionReceipt({
      ...transactionReceipt as TransactionReceiptParams,
      logs: transactionReceipt.logs, // defined as "#logs" in TransactionReceipt, and thus "..." above doesn't collect its value
      hash: this.userOpHash
      //   transactionHash: transactionReceipt.hash
    }, this.erc4373Provider)
    rcpt.confirmations = async () => await Promise.resolve(1)
    // TODO: set also getter methods?
    debug('got event with status=', event.args.success, 'gasUsed=', transactionReceipt.gasUsed)

    // before returning the receipt, update the status from the event.
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    this.stop()
    debug('resolving rcpt')
    if (!(event.args.success as boolean)) {
      await this.extractFailureReason(rcpt)
    } else {
      this.resolve(rcpt)
    }
    this.resolved = true
  }

  async extractFailureReason (receipt: TransactionReceipt): Promise<void> {
    debug('mark tx as failed')
    // WTF: can we change readonly field:
    // @ts-ignore
    receipt = new TransactionReceipt({
      ...receipt as TransactionReceiptParams,
      logs: receipt.logs,
      hash: this.userOpHash,
      status: 0
      //   transactionHash: transactionReceipt.hash
    }, this.erc4337Provider)
    const revertReasonEvents = await this.entryPoint.queryFilter(this.entryPoint.filters.UserOperationRevertReason(this.userOpHash, this.sender), receipt.blockHash)
    let message = 'UserOp reverted'
    if (revertReasonEvents[0] != null) {
      message = revertReasonEvents[0].args.revertReason
      if (message.startsWith('0x08c379a0')) {
        // Error(string)
        message = defaultAbiCoder.decode(['string'], '0x' + message.substring(10)).toString()
      }
    }
    debug(`rejecting with reason: ${message}`)
    this.reject(new Error(`UserOp failed with reason: ${message}`))
  }
}
