import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer, Wallet, ethers } from 'ethers'
import {
  IEntryPoint,
  SimpleAccount,
  SimpleAccount__factory,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  ISimpleAccountFactory,
  IEntryPoint__factory,
  UserOperation,
  IEntryPointSimulations,
  IEntryPointSimulations__factory,
} from '@account-abstraction/utils'
import axios from 'axios'
import { ValidationManager } from '@account-abstraction/validation-manager'
import { UserOpMethodHandler } from '../src/UserOpMethodHandler'
import { arrayify, hexlify, parseEther } from 'ethers/lib/utils'
import { ecsign, toRpcSig, keccak256 as keccak256_buffer } from 'ethereumjs-util'

import { getUserOpHash } from '@account-abstraction/utils'

import { packUserOp, resolveHexlify } from '../../utils'

describe('BundlerSendOP', function () {
  let provider: JsonRpcProvider
  let owner: string
  let wallet: Wallet
  let signer: Signer
  let entryPoint: IEntryPoint
  let entryPointAddress: string
  let smartAccount: SimpleAccount
  let smartAccountAddress: string
  let entryPointSimulationAddress: string
  let entryPointSimulation: IEntryPointSimulations
  let smartAccountFactoryAddress: string
  let smartAccountFactory: SimpleAccountFactory
  const key = 1

  before(async function () {
    provider = new ethers.providers.JsonRpcProvider('https://jsonrpc.euphoria.aura.network')
    wallet = ethers.Wallet.fromMnemonic('beef put scare clinic useless wheel gift flower family unable bomb owner')
    signer = wallet.connect(provider)
    owner = '0x7875b83FEDF0d9FB12Fcb7D4351bE1FCE19a3ef7'
    entryPointAddress = '0xfbC1a3AD32465bea6605d3bb7E6387caCa9337AC'
    entryPoint = IEntryPoint__factory.connect(entryPointAddress, signer)
    // smartAccountFactoryAddress = '0xa30F7A54b5f1102a01F6A590947BBBc6232F60C6'
    // smartAccountFactory = SimpleAccountFactory__factory.connect(smartAccountFactoryAddress, signer)
    // const res = await smartAccountFactory.createAccount(owner, '2432342342324234324234324234243223218')
    // console.log('res', res)
    smartAccountAddress = '0x4db902bd293768785c193c475f015da6135b2277'
    smartAccount = SimpleAccount__factory.connect(smartAccountAddress, provider)
  })

  it('op should be sent success', async function () {
    // prefund SA
    if ((await provider.getBalance(smartAccountAddress)) < parseEther('0.2')) {
      console.log('prefund account')
      const res = await signer.sendTransaction({ to: smartAccountAddress, value: parseEther('0.5') })
      console.log('prefund SA res', res)

      // deposit to EntryPoint
      await entryPoint.depositTo(smartAccountAddress, { value: parseEther('0.1') })
      let preDeposit = await entryPoint.balanceOf(smartAccountAddress)
      console.log('preDeposit', preDeposit)
    }

    // sendUserOperation is async, even in auto-mining. need to wait for it.
    const receivedAddr = '0xF4FC193579bCdA3172Fb7C49610e831b033D8d10'
    const amount = '10000000000000000' // amount to send to RECEIVER_ADDR
    const callData = smartAccount.interface.encodeFunctionData('execute', [receivedAddr, amount, '0x'])
    if (callData === undefined) {
      return
    }
    const sequenceNumber = await smartAccount.getNonce()
    const nonce = await entryPoint.getNonce(smartAccountAddress, sequenceNumber)

    let op: UserOperation = {
      sender: smartAccount.address,
      nonce,
      callData,
      callGasLimit: 500000,
      verificationGasLimit: 200000,
      preVerificationGas: 50000,
      maxFeePerGas: 1000000000,
      maxPriorityFeePerGas: 1000000000,
      signature: '',
    }

    const signUserOp = async (
      op: UserOperation,
      signer: Wallet,
      entryPoint: string,
      chainId: number
    ): Promise<UserOperation> => {
      const message = getUserOpHash(op, entryPoint, chainId)
      const signature = await signer.signMessage(arrayify(message))

      return {
        ...op,
        signature,
      }
    }
    const signedOp = await signUserOp(op, wallet, entryPointAddress, 6321)
    const hexlifiedOp = await resolveHexlify(signedOp)

    const options = {
      method: 'POST',
      url: 'http://localhost:3000/rpc',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendUserOperation',
        params: [hexlifiedOp, entryPointAddress],
      },
    }
    const res = await axios
      .request(options)
      .then(function (response) {
        return response.data
      })
      .catch(function (error) {
        console.log('BundlerTest error', error)
      })
    console.log('res', res)
  })
})
