import { ERC7562Call } from './ERC7562Call'
import Debug from 'debug'
import { IEntryPoint__factory, IPaymaster__factory, SenderCreator__factory } from '@account-abstraction/utils'
import { FunctionFragment, Interface } from 'ethers/lib/utils'

const debug = Debug('aa.dump')

let AbiInterfaces: Interface | undefined

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

export function _tryDetectKnownMethod (erc7562Call: ERC7562Call): string {
  if (AbiInterfaces == null) {
    const mergedAbi = Object.values([
      ...RIP7560EntryPointABI,
      ...SenderCreator__factory.abi,
      ...IEntryPoint__factory.abi,
      ...IPaymaster__factory.abi
    ])
    AbiInterfaces = new Interface(mergedAbi)
  }
  const methodSig = erc7562Call.input.slice(0, 10)
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
export function dumpCallTree (call: ERC7562Call, mapAddrs = {}, indent = ''): void {
  const map = (addr: string): string => mapAddrToName(mapAddrs, addr)
  debug(`${indent} ${map(call.from)} => ${call.type} ${call.to} ${map(call.to)}.${_tryDetectKnownMethod(call)}`)
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
