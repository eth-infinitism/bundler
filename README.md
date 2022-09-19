# EIP4337 reference modules

## Bundler

A basic eip4337 "bundler"

- expose a node with a minimal RPC calls:
  - eth_sendUserOperation to send a user operation
  - eth_supportedEntryPoints to report the bundler's supported entry points
  - eth_chainId


usage: 
1. start hardhat-node or geth
2. run `yarn run bundler --network localhost --mnemonic file` in another window.
  so it will listen on port 3000
3. to run a simple test, do `yarn run runop --network localhost`
  AA_URL=http://localhost:3000/rpc yarn runop --network goerli
  ```

it should be able to mine the transaction
