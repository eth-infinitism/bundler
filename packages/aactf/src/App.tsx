// @ts-ignore
import React from 'react'
import './App.css'
import { CaptureTheFlag } from './components/CaptureTheFlag'
import { CtfInfo } from './components/CtfInfo'

function App () {
  return (
    <div className="App">
      <header className="App-header">
        <CaptureTheFlag/>
        <CtfInfo/>
      </header>
    </div>
  )
}

export default App
