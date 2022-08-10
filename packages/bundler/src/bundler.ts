import minimist from "minimist";
import {ethers, utils, Wallet} from "ethers";
import * as fs from "fs";
import {formatEther, parseEther} from "ethers/lib/utils";
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import {BundlerHelper__factory, EntryPoint__factory} from "./typechain-types";
import {network} from "hardhat";

// this is done so that console.log outputs BigNumber as hex string instead of unreadable object
export const inspect_custom_symbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspect_custom_symbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

//deploy with "hardhat deploy --network goerli"
const DefaultBundlerHelperAddress = '0xdD747029A0940e46D20F17041e747a7b95A67242';

const supportedEntryPoints = [
  '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69'
]

const args = minimist(process.argv.slice(2), {
  alias: {
    b: 'beneficiary',
    f: 'gasFactor',
    M: 'minBalance',
    n: 'network',
    m: 'mnemonic',
    H: 'helper',
    p: 'port'
  }
})

function fatal(msg: string): never {
  console.error('fatal:', msg)
  process.exit(1)
}

function usage(msg: string) {
  console.log(msg)
  console.log(`
usage: yarn run bundler [options]
  --port - server listening port (default to 3000)
  --beneficiary address to receive funds (defaults to signer)
  --minBalance - below this signer balance, use itself, not --beneficiary  
  --gasFactor - require that much on top of estimated gas (default=1)
  --network - network name/url
  --mnemonic - file
  --helper - BundlerHelper contract. deploy with "hardhat deploy"
  `)
}

function getParam(name: string, defValue?: string | number): string {
  let value = args[name] || process.env[name] || defValue
  if (typeof defValue == 'number') {
    value = parseFloat(value)
  }
  if (value == null) {
    usage(`missing --${name}`)
  }
  // console.log(`getParam(${name}) = "${value}"`)
  return value
}

const provider = ethers.getDefaultProvider(getParam('network'))

const mnemonic = fs.readFileSync(getParam('mnemonic'), 'ascii').trim()
const signer = Wallet.fromMnemonic(mnemonic).connect(provider)

const beneficiary = getParam('beneficiary', signer.address)

// TODO: this is "hardhat deploy" deterministic address.
const helperAddress = getParam('helper', DefaultBundlerHelperAddress)
const minBalance = parseEther(getParam('minBalance', '0'))
const gasFactor = parseFloat(getParam('gasFactor', 1))
const port = getParam('port', 3000)

const bundlerHelper = BundlerHelper__factory.connect(helperAddress, signer)

// noinspection JSUnusedGlobalSymbols
class MethodHandler {

  async eth_chainId() {
    return provider.getNetwork().then(net => utils.hexlify(net.chainId))
  }

  async eth_supportedEntryPoints() {
    return supportedEntryPoints
  }

  async eth_sendUserOperation(userOp: any, entryPointAddress: string) {
    const entryPoint = EntryPoint__factory.connect(entryPointAddress, signer)
    if (!supportedEntryPoints.includes(utils.getAddress(entryPointAddress))) {
      throw new Error(`entryPoint "${entryPointAddress}" not supported. use one of ${supportedEntryPoints.toString()}`)
    }
    console.log(`userOp ep=${entryPointAddress} sender=${userOp.sender} pm=${userOp.paymaster}`)
    const currentBalance = await provider.getBalance(signer.address)
    let b = beneficiary
    // below min-balance redeem to the signer, to keep it active.
    if (currentBalance.lte(minBalance)) {
      b = signer.address
      console.log('low balance. using ', b, 'as beneficiary instead of ', beneficiary)
    }

    const [estimateGasRet, estHandleOp, staticRet] = await Promise.all([
      bundlerHelper.estimateGas.handleOps(0, entryPointAddress, [userOp], b),
      entryPoint.estimateGas.handleOps([userOp], b),
      bundlerHelper.callStatic.handleOps(0, entryPointAddress, [userOp], b),
    ])
    const estimateGas = estimateGasRet.mul(64).div(63)
    console.log('estimated gas', estimateGas.toString())
    console.log('handleop est ', estHandleOp.toString())
    console.log('ret=', staticRet)
    console.log('preVerificationGas', parseInt(userOp.preVerificationGas))
    console.log('verificationGas', parseInt(userOp.verificationGas))
    console.log('callGas', parseInt(userOp.callGas))
    const reqid = entryPoint.getRequestId(userOp)
    const estimateGasFactored = estimateGas.mul(Math.round(gasFactor * 100000)).div(100000)
    await bundlerHelper.handleOps(estimateGasFactored, entryPointAddress, [userOp], b)
    return await reqid
  }
}

const methodHandler: { [key: string]: (...params: any[]) => void } = new MethodHandler() as any

async function handleRpcMethod(method: string, params: any[]): Promise<any> {
  const func = methodHandler[method]
  if (func == null) {
    throw new Error(`method ${method} not found`)
  }
  return func.apply(methodHandler, params)
}

async function main() {

  const bal = await provider.getBalance(signer.address)
  console.log('signer', signer.address, 'balance', utils.formatEther(bal))
  if (bal.eq(0)) {
    fatal(`cannot run with zero balance`)
  } else if (bal.lte(minBalance)) {
    console.log('WARNING: initial balance below --minBalance ', formatEther(minBalance))
  }

  if (await provider.getCode(bundlerHelper.address) == '0x') {
    fatal('helper not deployed. run "hardhat deploy --network ..."')
  }

  const app = express()
  app.use(cors())
  app.use(bodyParser.json())


  const intro: any = (req: any, res: any) => {
    res.send('Account-Abstraction Bundler. please use "/rpc"')
  }
  app.get('/', intro)
  app.post('/', intro)
  app.post('/rpc', function (req, res) {
    const {method, params, jsonrpc, id} = req.body
    handleRpcMethod(method, params)
      .then(result => {
        console.log('sent', method, '-', result)
        res.send({jsonrpc, id, result})
      })
      .catch(err => {
        const error = {message: err.error?.reason ?? err.error, code: -32000}
        console.log('failed: ', method, error)
        res.send({jsonrpc, id, error})
      })
  })
  app.listen(port)
  console.log(`connected to network`, await provider.getNetwork().then(net => {
    net.name, net.chainId
  }))
  console.log(`running on http://localhost:${port}`)
}

main()
  .catch(e => console.log(e))
