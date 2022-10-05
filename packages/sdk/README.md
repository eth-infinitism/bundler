# SDK to create and send UserOperation 

This package provides 2 APIs for using UserOperations:

- Low-level "walletAPI"
- High-level Provider


## LowLevel API:

### BaseWalletAPI

An abstract base-class to create UserOperation for a contract wallet.

### SimpleWalletAPI

An implementation of the BaseWalletAPi, for the SimpleWallet sample of account-abstraction.

```typescript
owner = provider.getSigner()
const walletAPI = new SimpleWalletAPI({
    provider, 
    entryPointAddress,
    owner,
    factoryAddress
})
const op = await walletAPi.createSignedUserOp({
  target: recipient.address,
  data: recipient.interface.encodeFunctionData('something', ['hello'])
})
```

## High-Level Provider API

A simplified mode that doesn't require a different wallet extension. 
Instead, the current provider's account is used as wallet owner by calling its "Sign Message" operation.

This can only work for wallets that use an EIP-191 ("Ethereum Signed Message") signatures (like our sample SimpleWallet)
Also, the UX is not great (the user is asked to sign a hash, and even the wallet address is not mentioned, only the signer)

```typescript
import { wrapProvider } from '@account-abstraction/sdk'

//use this account as wallet-owner (which will be used to sign the requests)
const signer = provider.getSigner()
const config = {
  chainId: await provider.getNetwork().then(net => net.chainId),
  entryPointAddress,
  bundlerUrl: 'http://localhost:3000/rpc'
} 
const aaProvider = await wrapProvider(provider, config, aasigner)
const walletAddress = await aaProvider.getSigner().getAddress()

// send some eth to the wallet Address: wallet should have some balance to pay for its own creation, and for calling methods.

const myContract = new Contract(abi, aaProvider)

// this method will get called from the wallet address, through account-abstraction EntryPoint
await myContract.someMethod()
```

