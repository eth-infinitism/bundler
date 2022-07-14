import minimist from "minimist";
//import {EntryPoint__factory} from "@account-abstraction/contracts/typechain/factories/EntryPoint__factory";
import {ethers, utils, Wallet} from "ethers";
import * as fs from "fs";
import {formatEther, formatUnits, parseEther} from "ethers/lib/utils";
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import {BundlerHelper__factory, EntryPoint__factory} from "../typechain-types";
import {network} from "hardhat";


export const inspect_custom_symbol = Symbol.for('nodejs.util.inspect.custom')
// @ts-ignore
ethers.BigNumber.prototype[inspect_custom_symbol] = function () {
  return `BigNumber ${parseInt(this._hex)}`
}

const DefaultBundlerHelperAddress = '0x6a4Fc27DC03d8e2aA200F40AAf63282C7d4CB291';

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

function getParam(name: string, defValue?: string | number): string {
  let value = args[name] || process.env[name] || defValue
  if (typeof defValue == 'number') {
    value = parseFloat(value)
  }
  if (value == null) {
    fatal(`missing --${name}`)
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
const gasFactor = getParam('gasFactor', 1)
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
    }

    let estimateGas = await bundlerHelper.estimateGas.handleOps(0, entryPointAddress, [userOp], b)
    estimateGas = estimateGas.mul(64).div(63)
    const gasPrice = await provider.getGasPrice()
    const expectedRedeem = gasPrice.mul(estimateGas).mul(gasFactor)
    console.log('estimated gas', estimateGas.toString(), 'current price', formatUnits(gasPrice, 'gwei'), 'expected', formatEther(expectedRedeem))

    const ret = await bundlerHelper.callStatic.handleOps(0, entryPointAddress, [userOp], b, {gasLimit: estimateGas})
    console.log('ret=', ret)
    const reqid = entryPoint.getRequestId(userOp)
    await bundlerHelper.handleOps(expectedRedeem, entryPointAddress, [userOp], b)
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
    fatal('helper not delpoyed. run "hardhat deploy --network ..."')
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
        //todo: extract the error without garbage..
        console.log('failed: ', method, error)
        res.send({jsonrpc, id, error: error.message})
      })
  })
  app.listen(port)
  console.log(`connected to network`, await provider.getNetwork())
  console.log(`running on http://localhost:${port}`)
}

main()
  .catch(e => console.log(e))
