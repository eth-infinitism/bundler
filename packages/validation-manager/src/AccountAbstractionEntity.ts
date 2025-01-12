export const enum AccountAbstractionEntity {
  sender = 'Sender',
  paymaster = 'Paymaster',
  factory = 'Factory',
  aggregator = 'Aggregator',
  senderCreator = 'SenderCreator',
  entryPoint = 'EntryPoint',
  // TODO: leaving 'fixme' entity for future refactor
  //  (some rules are checked in a way that makes it hard to find entity)
  fixme = 'fixme'
}
