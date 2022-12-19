import { PaymasterAPI } from './PaymasterAPI'

/**
 * configuration params for wrapProvider
 */
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
   * required ZeroDev project id
   */
  projectId: string

  /**
   * if set, use this pre-deployed account.
   * (if not set, use getSigner().getAddress() to query the "counterfactual" address of account.
   *  you may need to fund this address so the account can pay for its own creation)
   */
  accountAddress?: string

  /**
   * the account factory address
   */
  accountFactoryAddress?: string

  /**
   * if set, call just before signing.
   */
  paymasterAPI?: PaymasterAPI
}
