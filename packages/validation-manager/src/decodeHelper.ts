import { ERC7562Call } from './ERC7562Call'
import Debug from 'debug'
import {
  IPaymaster__factory,
  IAccount__factory,
  SenderCreator__factory,
  IEntryPoint__factory
} from '@account-abstraction/utils'
import { FunctionFragment, Interface } from 'ethers/lib/utils'
import { IRip7560Account__factory, IRip7560Paymaster__factory } from '@account-abstraction/utils/dist/src/types'

const debug = Debug('aa.dump')

export function get4bytes (input: string): string {
  return input.slice(0, 10)
}

// TODO: Use artifact from the submodule
const RIP7560EntryPointABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address'
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'paymaster',
        type: 'address'
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'deployer',
        type: 'address'
      }
    ],
    name: 'RIP7560AccountDeployed',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address'
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'paymaster',
        type: 'address'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceKey',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceSequence',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'executionStatus',
        type: 'uint256'
      }
    ],
    name: 'RIP7560TransactionEvent',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address'
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'paymaster',
        type: 'address'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceKey',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceSequence',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'revertReason',
        type: 'bytes'
      }
    ],
    name: 'RIP7560TransactionPostOpRevertReason',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'sender',
        type: 'address'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceKey',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'nonceSequence',
        type: 'uint256'
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'revertReason',
        type: 'bytes'
      }
    ],
    name: 'RIP7560TransactionRevertReason',
    type: 'event'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'validAfter',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      }
    ],
    name: 'acceptAccount',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'validAfter',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      },
      {
        internalType: 'bytes',
        name: 'context',
        type: 'bytes'
      }
    ],
    name: 'acceptPaymaster',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'validAfter',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      }
    ],
    name: 'sigFailAccount',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'validAfter',
        type: 'uint256'
      },
      {
        internalType: 'uint256',
        name: 'validUntil',
        type: 'uint256'
      },
      {
        internalType: 'bytes',
        name: 'context',
        type: 'bytes'
      }
    ],
    name: 'sigFailPaymaster',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

const abis = [
  ...RIP7560EntryPointABI,
  ...IRip7560Account__factory.abi,
  ...IRip7560Paymaster__factory.abi,
  ...SenderCreator__factory.abi,
  ...IEntryPoint__factory.abi,
  ...IPaymaster__factory.abi,
  ...IAccount__factory.abi
]

function uniqueNames (arr: any[]): any[] {
  const map = new Map()
  for (const item of arr) {
    map.set(item.name, item)
  }
  return Array.from(map.values())
}

const AbiInterfaces = new Interface(uniqueNames(abis))

export function _tryDetectKnownMethod (erc7562Call: ERC7562Call): string {
  let input = erc7562Call.input
  if (input == null) {
    return '<no-input>'
  }
  if (!input.startsWith('0x')) {
    // base64 encoded input
    input = '0x' + Buffer.from(input, 'base64').toString('hex')
  }
  const methodSig = get4bytes(erc7562Call.input)
  try {
    const abiFunction: FunctionFragment = AbiInterfaces.getFunction(methodSig)
    return abiFunction.name
  } catch (_) {}
  return methodSig
}

function mapAddrToName (mapAddrs: {[name: string]: string}, addr: string): string {
  if (addr == null) {
    return addr
  }
  for (const name of Object.keys(mapAddrs)) {
    if (mapAddrs[name]?.toString().toLowerCase() === addr.toLowerCase()) {
      return name
    }
  }
  return addr
}

// recursively dump call tree, and storage accesses
export function dumpCallTree (call: ERC7562Call, mapAddrs: {[name: string]: any} = {}, indent = ''): void {
  if (indent === '') {
    debug('=== dumpCallTree ===')
  }
  const map = (addr: string): string => mapAddrToName(mapAddrs, addr)
  debug(`${indent} ${map(call.from)} => ${call.type} ${map(call.to)}.${_tryDetectKnownMethod(call)} : ${call.output} ${call.error} ${call.outOfGas}`)
  for (const access of ['reads', 'writes']) {
    const arr = (call.accessedSlots as any)[access]
    if (arr != null) {
      for (const [idx, val] of Object.entries(arr)) {
        debug(`${indent}   - ${access}  ${idx}: ${val as string}`)
      }
    }
  }
  for (const innerCall of call.calls ?? []) {
    dumpCallTree(innerCall, mapAddrs, indent + '  ')
  }
}
