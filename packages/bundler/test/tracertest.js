//javascript code of tracer function
//NOTE: we process this locally for hardhat, but send to geth for remote tracing.
// should NOT "require" anything, or use logs.
// see LogTrace for valid types (but alas, this one must be javascript, not typescript..

/**
 * tracer to collect data for opcode banning.
 * exported object for internal use: remove the "module.exports=" when sending as a string to geth.
 * returned data:
 *  opcodes: mapping from opcode name to count
 *  keccak: whenever a keccak over a 64-byte memory is done, collect the 64 bytes (as 2 32-byte uint values)
 *  calls: for each call, an array of [type, from, to, value]
 *  writes: count writes in contract addresses (not slots)
 *  reads: count reads on contract addresses
 *  slots: accessed slots (on any address)
 */
module.exports = {
  opcodes: {},
  keccak: [],
  calls: [],
  writes: {},
  reads: {},
  slots: {},
  logs: [],

  fault: function (log) {
    this.logs.push(['fault', log.getError()])
  },

  result: function (ctx) {
    return {
      keccak: this.keccak,
      reads: this.reads,
      calls: this.calls,
      writes: this.writes,
      slots: this.slots,
      opcodes: this.opcodes,
      // logs: this.logs  //for internal debugging.
    }
  },

  enter (frame) {
    this.calls.push({
      type: frame.getType(),
      from: toHex(frame.getFrom()),
      to: toHex(frame.getTo()),
      value: frame.getValue()
    })
  },
  exit () {
  },
  countSlot (list, key) {
    // this.logs.push(['countSlot', list, key])
    list[key] = (list[key] || 0) + 1
  },
  step (log, db) {
    let opcode = log.op.toString()
    this.countSlot(this.opcodes, opcode)

    if (opcode == 'SLOAD' || opcode == 'SSTORE') {
      let slot = log.stack.peek(0).toString(16)
      this.countSlot(this.slots, slot)
      let addr = toHex(log.contract.getAddress())
      this.countSlot(opcode == 'SLOAD' ? this.reads : this.writes, addr)
    }

    const OPCODE_KECCAK = 0x20
    if (log.op.toNumber() == OPCODE_KECCAK) {
      //collect keccak on 64-byte blocks
      const ofs = log.stack.peek(0)
      const len = log.stack.peek(1)
      if (len == 64) {
        this.keccak.push([
          log.memory.getUint(ofs).toString(16),
          log.memory.getUint(ofs + 32).toString(16)
        ])
      }
    }
  }
}
