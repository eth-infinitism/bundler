import * as constants from './constants'

export const signUserOp = async (
  projectId: string,
  userOp: any,
  paymasterUrl?: string
): Promise<string> => {
  const resp = await fetch(`${paymasterUrl ?? constants.PAYMASTER_URL}/sign`, {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      userOp
    }),
    headers: { 'Content-Type': 'application/json' }
  })
  const { signature } = await resp.json()
  return signature
}

export const getChainId = async (
  projectId: string,
  backendUrl?: string
): Promise<number> => {
  const resp = await fetch(
    `${backendUrl ?? constants.BACKEND_URL}/v1/projects/get-chain-id`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId
      }),
      headers: { 'Content-Type': 'application/json' }
    }
  )
  const { chainId } = await resp.json()
  return chainId
}

export const getPrivateKeyByToken = async (
  projectId: string,
  identity: string,
  token: string,
  backendUrl?: string
): Promise<string> => {
  const resp = await fetch(
    `${backendUrl ?? constants.BACKEND_URL}/v1/keys/get-by-token`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectId,
        identity,
        token
      }),
      headers: { 'Content-Type': 'application/json' }
    }
  )
  const { privateKey } = await resp.json()
  return privateKey
}
