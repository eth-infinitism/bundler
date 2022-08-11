import { program } from 'commander'
import { erc4337RuntimeVersion } from '@erc4337/common'

program
  .version(erc4337RuntimeVersion)
  .option('-s, --separator <char>', 'hello hello', '777')
  .parse()

console.log(program.opts().separator)

export async function preflightCheck (): Promise<void> {

}

