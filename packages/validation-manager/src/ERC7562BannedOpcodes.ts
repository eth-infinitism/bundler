export const bannedOpCodes = new Set(['GASPRICE', 'GASLIMIT', 'DIFFICULTY', 'TIMESTAMP', 'BASEFEE', 'BLOCKHASH', 'NUMBER', 'ORIGIN', 'GAS', 'COINBASE', 'SELFDESTRUCT', 'RANDOM', 'PREVRANDAO', 'INVALID'])
// opcodes allowed in staked entities [OP-080]
export const opcodesOnlyInStakedEntities = new Set(['BALANCE', 'SELFBALANCE'])
