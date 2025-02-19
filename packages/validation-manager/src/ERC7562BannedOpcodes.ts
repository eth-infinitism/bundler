/**
 * [OP-011] the opcodes banned for all entities.
 */
export const bannedOpCodes = new Set(
  [
    'BASEFEE',
    'BLOCKHASH',
    'COINBASE',
    'DIFFICULTY',
    'GAS',
    'GASLIMIT',
    'GASPRICE',
    'INVALID',
    'NUMBER',
    'ORIGIN',
    'PREVRANDAO',
    'RANDOM',
    'SELFDESTRUCT',
    'TIMESTAMP',
    'BLOBHASH',
    'BLOBBASEFEE'
  ]
)

/**
 * [OP-080] the opcodes allowed in staked entities.
 */
export const opcodesOnlyInStakedEntities = new Set(
  [
    'BALANCE',
    'SELFBALANCE'
  ]
)
