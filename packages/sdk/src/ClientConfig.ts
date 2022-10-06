/**
 * configuration params for wrapProvider
 */
import { PaymasterAPI } from './PaymasterAPI'

export interface ClientConfig {
  /**
   * the entry point to use
   */
  entryPointAddress: string
  /**
   * url to the bundler
   */
  bundlerUrl: string
  /**
   * chainId of current network. used to validate against the bundler's chainId
   */
  chainId: number
  /**
   * if set, use this pre-deployed wallet.
   * (if not set, use getSigner().getAddress() to query the "counterfactual" address of wallet.
   *  you may need to fund this address so the wallet can pay for its own creation)
   */
  walletAddres?: string
  /**
   * if set, call just before signing.
   */
  paymasterAPI?: PaymasterAPI
}
