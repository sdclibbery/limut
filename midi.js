'use strict'
define(function(require) {
  let consoleOut = require('console')
  let scale = require('music/scale')

  let createinputChannel = () => { return {
    controller: {},
    bend: 0,
    note: {},
    listeners: {},
    notes: [],
    vel: 0,
  } }

  let midi
  let connecting = false
  let inputs = []
  let portIndexes = {} // MIDIInput.id -> the port number limut knows it by
  let lastInput

  // A port that disconnects with a note held never sends its note off, so that note would sustain,
  // and keep rendering, for ever (its envelope only arms its teardown on release - play/envelopes.js).
  // Release everything sounding on the port instead.
  let releasePort = (idx) => {
    let port = inputs[idx]
    if (!port) { return }
    for (let channelNumber in port) {
      let channel = port[channelNumber]
      let held = channel.notes.slice()
      channel.notes = []
      channel.note = {}
      channel.vel = 0
      held.forEach(noteNumber => {
        for (let k in channel.listeners) {
          channel.listeners[k](noteNumber, undefined) // Note off notified with undefined velocity
        }
      })
    }
  }
  let connect = () => {
    if (connecting) { return }
    connecting = true
    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        midi = midiAccess
        midi.onstatechange = (event) => {
          let port = event.port
          if (!port || port.type !== 'input' || port.state !== 'disconnected') { return }
          let idx = portIndexes[port.id]
          if (idx === undefined) { return }
          consoleOut(`🟠 MIDI port ${idx} disconnected: ${port.manufacturer} ${port.name}`)
          releasePort(idx)
        }
        let ctr = 0
        midi.inputs.forEach((port) => {
          let idx = ctr
          portIndexes[port.id] = idx
          consoleOut(`🔵 MIDI port ${idx}: ${port.manufacturer} ${port.name}`)
          port.open().then(() => {
            port.onmidimessage = (msg) => {
              if (inputs[idx] === undefined) { inputs[idx] = {} }
              var cmd = msg.data[0] >> 4
              var channelNumber = msg.data[0] & 0xf
              if (inputs[idx][channelNumber] === undefined) {
                inputs[idx][channelNumber] = createinputChannel()
              }
              let channel = inputs[idx][channelNumber]
              // console.log(cmd, channelNumber, msg.data)
              if (cmd === 11) { // Controller
                var controlNumber = msg.data[1]
                var value = msg.data[2]
                channel.controller[controlNumber] = (value || 0) / 127
                lastInput = `Port ${idx} Channel ${channelNumber} Controller ${controlNumber}`
              }
              if (cmd === 14) { // Bend
                var ms = msg.data[2]
                var ls = msg.data[1]
                var value = (ms << 7) + ls
                channel.bend = (value - 8192) / 8191
                lastInput = `Port ${idx} Bend ${channelNumber}`
              }
              if (cmd === 8 || cmd === 9) { // Note
                var noteNumber = msg.data[1]
                var velocity = msg.data[2] / 127
                channel.note[noteNumber] = velocity || 0
                lastInput = `Port ${idx} Channel ${channelNumber} Note ${noteNumber}`
                if (cmd === 9) { // Note on
                  channel.notes.push(noteNumber)
                  channel.vel = velocity || 0
                  for (let k in channel.listeners) {
                    let listener = channel.listeners[k]
                    listener(noteNumber || 0, velocity || 0)
                  }
                } else { // Note off
                  channel.notes = channel.notes.filter((n) => n !== noteNumber)
                  if (channel.notes.length === 0) { channel.vel = 0 }
                  for (let k in channel.listeners) {
                    let listener = channel.listeners[k]
                    listener(noteNumber || 0, undefined) // Note off notified with undefined velocity
                  }
                }
              }
              if (cmd === 13) { // Aftertouch
                var aftertouch = msg.data[1] / 127
                for (let n in channel.note) {
                  if (channel.note[n] > 0) {
                    channel.note[n] = aftertouch || 0
                  }
                }
                channel.vel = aftertouch || 0
                lastInput = `Port ${idx} Channel ${channelNumber} Aftertouch`
              }
            }
          })
          ctr++
        })
      },
      () => { consoleOut('🔴 No midi access available') }
    )
  }

  let getValue = (portNumber, channelNumber, controlId, noteNumber) => {
    if (!midi) { connect() }
    let port = inputs[portNumber]
    if (!port) { return 0 }
    let channel = port[channelNumber]
    if (!channel) { return 0 }
    if (controlId === 'bend') { return channel.bend || 0 }
    if (controlId === 'notes') {
      let root = scale.root || 0
      return (channel.notes || [])
        .map(n => n - 60 - root)
    }
    if (controlId === 'vel') { return channel.vel || 0 }
    if (controlId !== undefined && channel.controller[controlId] !== undefined) { return channel.controller[controlId] }
    return channel.note[noteNumber] || 0
  }

  let getLastInputString = () => {
    if (!midi) { connect() }
    return lastInput
  }

  let listen = (portNumber, channelNumber, id, callback) => {
    if (!midi) { connect() }
    if (inputs[portNumber] === undefined) { inputs[portNumber] = {} }
    if (inputs[portNumber][channelNumber] === undefined) { inputs[portNumber][channelNumber] = createinputChannel() }
    let channel = inputs[portNumber][channelNumber]
    channel.listeners[id] = callback
  }

  let midIgnore = (portNumber, channelNumber, id) => {
    if (inputs[portNumber] === undefined) { return }
    if (inputs[portNumber][channelNumber] === undefined) { return }
    let channel = inputs[portNumber][channelNumber]
    delete channel.listeners[id]
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }

  { // A disconnecting port releases the notes it left held (its note offs are never coming)
    let idx = 99
    inputs[idx] = {0: createinputChannel()}
    let channel = inputs[idx][0]
    let calls = []
    channel.listeners['test'] = (note, velocity) => calls.push([note, velocity])
    channel.notes.push(60)
    channel.note[60] = 1
    channel.vel = 1
    releasePort(idx)
    assert(1, calls.length, 'the held note was released')
    assert('60,', ''+calls[0], 'released with an undefined velocity, like a real note off')
    assert(0, channel.notes.length)
    assert(0, channel.vel)
    releasePort(idx)
    assert(1, calls.length, 'nothing held, nothing released')
    delete inputs[idx]
  }

  console.log('Midi tests complete')
  }

  return {
    getValue: getValue,
    connect: connect,
    getLastInputString: getLastInputString,
    listen: listen,
    stopListening: midIgnore,
  }
})