const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const minimist = require('minimist')
const fs = require("fs")
const entryPointArtifact = require('./EntryPoint.json')
const {Contract, BigNumber, Wallet, utils} = require("ethers");

const supportedEntryPoints = [
  '0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69'
]

const ethers = require('ethers')
const {log} = require("util");

const args = minimist(process.argv.slice(2), {
    alias: {
        n: 'network',
        m: 'mnemonic',
	p: 'port'
    }
})

function fatal(msg) {
    console.error('fatal:', msg)
    process.exit(1)
}

function getParam(name, defValue) {
    let value = args[name] || process.env[name] || defValue
    if (value == null) {
        fatal(`missing --${name}`)
    }
    // console.log(`getParam(${name}) = "${value}"`)
    return value
}

const provider = ethers.getDefaultProvider(getParam('network'))

const mnemonic = fs.readFileSync(getParam('mnemonic'), 'ascii').trim()

const port = getParam('port', 3000)

const signer = Wallet.fromMnemonic(mnemonic).connect(provider)

provider.getBalance(signer.address).then(bal => console.log('signer', signer.address, 'balance', utils.formatEther(bal)))

const app = express()
app.use(cors())
app.use(bodyParser.json())

class MethodHandler {
    async eth_chainId() {
        return provider.getNetwork().then(net => utils.hexlify(net.chainId))
    }

    async eth_supportedEntryPoints() {
        return supportedEntryPoints
    }

    async eth_sendUserOperation(userOp, entryPointAddress) {
        const entryPoint = new Contract(entryPointAddress, entryPointArtifact.abi, signer)
        if (!supportedEntryPoints.includes(utils.getAddress(entryPointAddress))) {
            throw new Error(`entryPoint "${entryPointAddress}" not supported`)
        }
        console.log(`userOp ep=${entryPointAddress} sender=${userOp.sender} pm=${userOp.paymaster}`)
        let beneficiary = signer.address
        const hasPaymaster = userOp.paymaster != ethers.constants.AddressZero

        const calcUserOpGas = BigNumber.from(userOp.verificationGas).mul(hasPaymaster ? 3 : 1).add(userOp.preVerificationGas).add(userOp.callGas).toNumber()
	const opGasPrice = Math.min(BigNumber.from(userOp.maxFeePerGas))
        console.log('calc gas from userOp=', calcUserOpGas)
        const paid = await entryPoint.callStatic.handleOps([userOp], beneficiary, { from:signer.address, gasLimit: calcUserOpGas } )
        let estGas = await entryPoint.estimateGas.handleOps([userOp], beneficiary, {
            from: signer.address,
            gasLimit: calcUserOpGas
        });
        console.log('est gas=', estGas.toNumber())
        const reqid = entryPoint.getRequestId(userOp)
        await entryPoint.handleOps([userOp], beneficiary)
        return await reqid
    }

    async _handle(method, params) {
        const func = this[method]
        if (func == null || func == this._handle) {
            throw new Error(`method ${method} not found`)
        }
        return func.apply(this, params)
    }
}

const methodHandler = new MethodHandler()

app.post('/rpc', function (req, res) {
    const {method, params, jsonrpc, id} = req.body
    methodHandler._handle(method, params)
        .then(result => {
            console.log(method, '-', result)
            res.send({jsonrpc, id, result})
        })
        .catch(err => {
	    const error = { message: err.message, code: -32000, data: err.stack }
            //todo: extract the error without garbage..
	    console.log( 'failed: ',method, error )
            res.send({jsonrpc, id, error: error.message})
        })
})
app.listen(port)
console.log(`running on http://localhost:${port}`)
