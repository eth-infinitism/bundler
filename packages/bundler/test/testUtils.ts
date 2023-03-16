import { BigNumber, Signer, Wallet } from 'ethers'
import { HDNode, parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'

// create an hdkey signer, and fund it, if needed.
export async function createSigner (): Promise<Signer> {
  const provider = ethers.provider
  const privateKey = HDNode.fromMnemonic('test '.repeat(11) + 'junk')
  const signer = new Wallet(privateKey, provider)
  const signerAddress = await signer.getAddress()
  const signerBalance = await signer.getBalance()
  if (signerBalance.lt(parseEther('10'))) {
    await ethers.provider.getSigner().sendTransaction({
      to: signerAddress,
      value: parseEther('10')
    })
  }
  return signer
}

// debugging helper:
// process json object, and convert any key or value that is a hex address into its name
//
export function resolveNames<T> (json: T, nameToAddress: { [name: string]: string }, onlyNames = false): T {
  const addressToNameMap: { [addr: string]: string } = Object.entries(nameToAddress)
    .reduce((set, [name, addr]) => ({
      ...set,
      [addr.toLowerCase().replace(/0x0*/, '')]: name
    }), {})
  const s = JSON.stringify(json)
  const s1 = s
    .replace(/[{]"type":"BigNumber","hex":"(.*?)"[}]/g, (_, hex) => BigNumber.from(hex).toString())
    .replace(/(0x0*)([0-9a-fA-F]+)+/g, (_, prefix: string, hex: string) => {
      const hexToName = addressToNameMap[hex.toLowerCase()]
      if (hexToName == null) return `${prefix}${hex}` // not found in map: leave as-is
      if (onlyNames) {
        return hexToName
      } else {
        return `${prefix}<${hexToName}>${hex}`
      }
    })
  return JSON.parse(s1)
}
