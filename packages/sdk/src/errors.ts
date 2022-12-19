const ErrSDKNotInitialized = Error('SDK not initialized')
const ErrUnsupportedNetwork = Error('Unsupported network')
const ErrUnsupportedIdentity = Error('Unsupported identity')
const ErrTransactionRejectedByUser = Error('Transaction rejected by user')
const ErrTransactionFailedGasChecks = Error('Transaction failed gas checks')
const ErrNoIdentifierProvided = Error(
  'No identity token, private key, or Web3 provider was provided'
)

export {
  ErrSDKNotInitialized,
  ErrUnsupportedNetwork,
  ErrUnsupportedIdentity,
  ErrTransactionRejectedByUser,
  ErrTransactionFailedGasChecks,
  ErrNoIdentifierProvided
}
