// @ts-ignore
import React, {useState} from 'react';

declare let global: { network: any }

// Utility components

export async function sleep(ms:number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const Ellipsis = '\u2026'

/** progress bar with title
 * show progress of "step" out of "total" (if both exist)
 * show title (if exists)
 */
export function Progress({status, step, total}: any) {
  return <pre>
      {total && ('['.padEnd(step, '=') + '>').padEnd(total + 1) + '] '}
    {status && status}
   </pre>
}

interface AddressProps {
  addr?: string
  network?: any
}

/**
 * network address. shortened to prefix..suffix .
 * if "network" is provided and contains "explorer" url prefix, then make the address a link
 */
export function Address({addr, network = global.network}: AddressProps) {
  return <a href={network?.explorer && network.explorer +'/address/' + addr} target="explorer">
    <span style={{"fontFamily": "monospace"}}>
      {("" + addr).replace(/^(.{6}).*(.{4})$/, `$1${Ellipsis}$2`)}
    </span></a>
}


/**
 * a button with async action function
 * button is disabled while async function is active, and re-enabled when it completes
 */
interface ActionButtonType {
  title: string
  action: () => Promise<void>
  enabled?: boolean
  onError: (e?: Error) => void
}

export function ActionButton({title, action, enabled = true, onError}: ActionButtonType) {

  const [disabled, setDisabled] = useState(!enabled)

  const onClick = () => {
    onError && onError();
    setDisabled(true);
    action()
      .catch(err => onError && onError(err))
      .finally(() => setDisabled(false))
  }

  return <button
    disabled={disabled}
    onClick={onClick}>
    {title}
  </button>
}

function formatDate(date: Date) {
  if (!date) return ""
  const min = (Date.now() - date.getTime()) / 1000 / 60
  if (min < 1) return "less than a minute ago"
  if (min < 120) return `${Math.round(min)} minutes ago`
  const hour = min / 60
  if (hour < 48) return `${Math.round(hour)} hours ago`
  const days = hour / 24
  // if ( days < 14 )
  return `${Math.round(days)} days ago`
}

export function LogEvent({cur, prev, date}: { cur: string, prev: string, date: Date }) {
  return <div> Captured the flag from <Address addr={prev}/> by <Address addr={cur}/> {formatDate(date)}</div>
}

/**
 * return a list of events to display (showing only the first "last" entries.)
 * note that the list is assumed to be sorted in reverse order
 */
export function Log({events, last = 5}: { events: any[] | undefined, last?: number }) {
  return <ul>
    {events && events.slice(0, last).map((e, key) =>
      <li key={key}><LogEvent cur={e.currentHolder} prev={e.previousHolder} date={e.date}/></li>
    )}
  </ul>
}
