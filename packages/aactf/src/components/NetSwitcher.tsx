// @ts-ignore
import React from 'react'
import { getNetworks, switchNetwork } from './Ctf'

function NetLink ({ index, name, chain }: { index: number, name: string, chain: string }) {
  // return <ActionButton title={name} action={() => switchNetwork(chain)} onError={async () => 0}/>
  return <>
    {index === 0 ? '' : ' , '}
    {/* eslint-disable-next-line jsx-a11y/anchor-is-valid*/}
    <a style={{ color: 'white' }} href="#" onClick={() => switchNetwork(chain)}>{name}</a>
  </>
}

export function NetSwitcher ({ currentChainId }: { currentChainId?: number }) {

  // @ts-ignore
  return <table border={1}
                style={{ fontSize: -2 }}>
    <tbody>
    <tr>
      <td>
        Switch to network:&nbsp;
        {
          Object.entries(getNetworks())
            .filter(([chain]) => currentChainId?.toString() !== chain)
            .map(([chain, name], index) =>
              <NetLink key={index} index={index} name={name} chain={chain}/>
            )
        }
      </td>
    </tr>
    </tbody>
  </table>
}
