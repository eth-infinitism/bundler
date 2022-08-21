import React, { Component } from 'react'
import { Progress, Address, ActionButton, Log, sleep } from './utils'
import { NetSwitcher } from './NetSwitcher'
import { Ctf, initCtf } from './Ctf'

declare let window: { ethereum: any }

interface CtfState {
  error?: string
  current?: string
  contractAddress?: string
  account?: string
  events?: any[]

  status?: string
  step?: number
  total?: number
}

export class CaptureTheFlag extends Component {

  state: CtfState = {}
  ctf?: Ctf

  async readContractInfo () {
    const ctf = this.ctf = await initCtf()

    // TODO: ALEXF: check metamask connected
    // if (await (ctf.ethersProvider as Web3Provider).listAccounts().then(arr => arr.length) === 0) {
    //   throw new Error('Connect metamask first')
    // }
    const [current, account] = await Promise.all([
      ctf.getCurrentFlagHolder(),
      ctf.getSigner()
    ])

    this.setState({
      contractAddress: ctf.address,
      account,
      current,
    })
    ctf.getPastEvents().then(events => {
      this.setState({
        events: this.prependEvents(undefined, events),
      })
    })

    ctf.listenToEvents(event => {
      this.log(event)
      this.setState({
        current: event.currentHolder
      })
    }, ({ event, step, total }) => {
      console.log({ event, step, total })
      this.progress({ event, step, total })
    })
  }

  // @ts-ignore
  progress ({ event, step, total, error = null }) {
    this.setState({ status: event, step, total, error })
  }

  async componentDidMount () {
    await this.readContractInfo()
      .catch(e => {
        console.log('ex=', e)
        this.setState({ error: e.message })
      })
  }

  componentWillUnmount () {
    this.ctf!.stopListenToEvents()
  }

  async simSend () {
    for (let i = 1; i <= 8; i++) {
      this.setState({ step: i, total: 8, status: null })
      await sleep(500)
    }
    this.setState({ status: 'Mining' })
    await sleep(300)
    this.setState({ status: 'done' })
  }

  // add new events to the array. newer event is FIRST. keep only the first 5 lines
  // (that is, latest 5 events)
  prependEvents (currentEvents: any[] | undefined, newEvents: any[]) {
    return [...(newEvents ?? []).reverse(), ...(currentEvents ?? [])].slice(0, 5)
  }

  log (event: any) {
    this.setState({ events: this.prependEvents(this.state.events, [event]) })
  }

  async doCapture () {
    this.setState({ status: 'sending' })
    const res = await this.ctf!.capture()
    this.setState({ status: 'txhash=' + res.hash.slice(0, 20) + ' waiting for mining' })
    const res2 = await res.wait()
    console.log('mined!')
    this.setState({ total: null, step: null, status: 'Mined in block: ' + res2.blockNumber })
  }

  render () {

    // @ts-ignore
    // @ts-ignore
    return <>
      <h1>Capture The Flag - Without Paying for Gas</h1>
      Click the button to capture the flag with your account, using ERC-4337
      <br/>
      {!this.state.account && <span> <ActionButton title="Connect to Metamask"
                                                   action={window.ethereum.enable}
                                                   onError={() => (e: Error) => this.setState({ error: e ? e.message : 'error' })}
      /><p/></span>}

      <ActionButton title="Click here to capture the flag"
                    enabled={!this.state.account}
                    action={() => this.doCapture()}
                    onError={(e?: Error) => {
                      console.log('==ex2', e)
                      this.setState({ error: e ? e.message : null })
                    }}/>
      <br/>
      Your account:<Address addr={this.state.account}/> <br/>
      CTF Contract: <Address addr={this.state.contractAddress}/><br/>
      Current flag holder: <Address addr={this.state.current}/>
      {this.state.current && this.state.current === this.state.account && '(you!)'}
      <br/>

      {this.state.error ?
        //@ts-ignore
        <font color="red">Error: {this.state.error}</font>
        :
        <Progress step={this.state.step} total={this.state.total} status={this.state.status}/>
      }

      <div style={{ textAlign: 'left' }}>

        <Log events={this.state.events}/>
      </div>

      <NetSwitcher currentChainId={this.ctf?.chainId}/>
    </>
  }
}
