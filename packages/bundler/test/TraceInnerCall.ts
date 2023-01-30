import { debug_traceCall, LogCallFrame, LogContext, LogFrameResult, LogTracer } from '../src/GethTracer'
import { JsonRpcProvider } from '@ethersproject/providers'
import { UserOperation } from '../src/modules/moduleUtils'
import { EntryPoint } from '@account-abstraction/contracts'
import { decodeErrorReason } from '@account-abstraction/utils'
import { arrayify } from 'ethers/lib/utils'
import { BigNumber } from 'ethers'

declare function toHex (a: any): string

interface GetInner extends LogTracer {
  sig?: string
  out?: any
}

//extract the return value of "innerHandleOp"
function InnerCallResult (): LogTracer {
  const trace: GetInner = {
    result (ctx: LogContext) {
      return {
        ctxGasUsed: ctx.gasUsed,
        out: toHex(ctx.output),
        innerCallGas: parseInt(this.out)
      }
    },
    fault () {
    },
    enter (frame: LogCallFrame): void {
      this.sig = toHex(frame.getInput().slice(0, 4))
    },

    exit (frame: LogFrameResult): void {
      //innerHandleOp(bytes,((address,uint256,uint256,uint256,uint256,address,uint256,uint256),bytes32,uint256,uint256,uint256),bytes)
      if (this.sig == '0x1d732756') {
        if (this.out != null) throw new Error('too many results')
        this.out = toHex(frame.getOutput())
      }
    }
  }
  return trace
}

/**
 * create a "handleOps" call with this operation, and return actual transaction gas used, and inner gas paid-for.
 * note that paid gas is not available directly (only in an event).
 * We expect the UserOp to have maxPossibleGas=1, so that we can use the gas paid for (from innerHandleOp)
 * @param entryPoint
 * @param op
 * @return gasUsed - actual gas used by transaction (paid by bundler)
 * @return gasPaid - gas refunded to beneficiary
 */
export async function traceUserOpGas (entryPoint: EntryPoint, op: UserOperation, sendAsRealTransaction = false): Promise<{ gasUsed: number, gasPaid: number }> {
  //for gas price to "1", so gas-price==gas-used
  op.maxFeePerGas = 1
  const provider = entryPoint.provider as JsonRpcProvider
  const signer = provider.getSigner()
  const beneficiary = signer.getAddress()

  const tx = await entryPoint.populateTransaction.handleOps([op], beneficiary, {gasLimit: 3e6})
  const callDataGas = arrayify(tx.data!).reduce((sum, x) => sum + ((x == 0) ? 4 : 16))

  let ret = await debug_traceCall(provider, tx, { tracer: InnerCallResult })
  const {
    ctxGasUsed,
    out,  //set only in case of exception
    innerCallGas
  } = ret
  console.log('trace ret=', ret)

  //extract actual "gasUsed" from trace call.
  // notice the magical "15" ...
  const calcGasUsed = ctxGasUsed + 21000 + callDataGas - 15

  if (sendAsRealTransaction) {
    await provider.call(tx)
    // await entryPoint.callStatic.handleOps([op], beneficiary)

    const rcpt = await signer.sendTransaction(tx).then(r => r.wait())
    // const rcpt = await entryPoint.handleOps([op], beneficiary)
    const [ev] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt.blockHash)
    console.log('actual gas used=', {
      gasUsed: rcpt.gasUsed,
      gasPaid: ev.args.actualGasUsed
    })
    console.log('ev=', ev.args)
    if (ev.args.actualGasUsed != innerCallGas) {
      throw new Error(`failed to extract paid gas: trace gas=${innerCallGas}, event gasUsed=${ev.args.actualGasUsed}`)
    }
    const diffGasUsed = calcGasUsed - rcpt.gasUsed.toNumber()
    if (diffGasUsed != 0) {
      throw new Error(`invalid calcGas=${calcGasUsed} real=${rcpt.gasUsed} diff=${diffGasUsed}`)
    }

  }

  if (innerCallGas == null) {
    throw new Error(`failed: ${decodeErrorReason(out ?? '0x')?.message ?? out} ${JSON.stringify(op)}`)
  }
  const gasPaid = BigNumber.from(innerCallGas)

  return {
    gasUsed: calcGasUsed,
    gasPaid: gasPaid.toNumber()
  }
}
