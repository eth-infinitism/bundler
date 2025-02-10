import ow from 'ow'
import { CallFrameType } from './altmempool/AltMempoolConfig'

export interface ContractSize {
  contractSize: number
  opcode: number
}

export interface AccessedSlots {
  reads?: Record<string, string[]>
  transientReads?: Record<string, unknown>
  transientWrites?: Record<string, unknown>
  writes?: Record<string, number>
}

export interface ERC7562Call {
  accessedSlots: AccessedSlots
  contractSize: Record<string, ContractSize>
  error?: string
  extCodeAccessInfo: string[]
  from: string
  gas: string
  gasUsed: string
  input: string
  outOfGas: boolean
  output?: string
  to: string
  type: CallFrameType
  usedOpcodes: Record<number, number>
  value?: string
  calls: ERC7562Call[]
  keccak?: string[]
}

const contractSizeSchema = ow.object.exactShape({
  contractSize: ow.number,
  opcode: ow.number
})

const accessedSlotsSchema = ow.object.exactShape({
  reads: ow.object.valuesOfType(ow.array.ofType(ow.string)),
  transientReads: ow.object,
  transientWrites: ow.object,
  writes: ow.object.valuesOfType(ow.number)
})

const erc7562CallSchema = ow.object.exactShape({
  accessedSlots: accessedSlotsSchema,
  contractSize: ow.object.valuesOfType(contractSizeSchema),
  error: ow.optional.string,
  extCodeAccessInfo: ow.array.ofType(ow.string),
  from: ow.string,
  gas: ow.string,
  gasUsed: ow.string,
  input: ow.string,
  outOfGas: ow.boolean,
  output: ow.optional.string,
  to: ow.string,
  type: ow.string,
  usedOpcodes: ow.object.valuesOfType(ow.number),
  value: ow.optional.string,
  calls: ow.optional.array,
  keccak: ow.optional.array.ofType(ow.string)
})

/**
 * Recursively check the calls ow schema.
 */
export function validateERC7562Call (value: ERC7562Call): void {
  ow(value, erc7562CallSchema)

  if (value.calls != null) {
    for (const call of value.calls) {
      validateERC7562Call(call)
    }
  }
}
