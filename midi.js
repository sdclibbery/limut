'use strict'
define(function(require) {
  let consoleOut = require('console')

  let createinputChannel = () => { return {
    controller: {},
    bend: 0,
    note: {},
    listeners: {},
  } }

  let midi
  let connecting = false
  let inputs = []
  let lastInput
  let connect = () => {
    if (connecting) { return }
    connecting = true
    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        midi = midiAccess
        let ctr = 0
        midi.inputs.forEach((port) => {
          let idx = ctr
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
                var value = msg.data[2]
                channel.bend = (value || 0) / 127
                lastInput = `Port ${idx} Bend ${channelNumber}`
              }
              if (cmd === 8 || cmd === 9) { // Note
                var noteNumber = msg.data[1]
                var velocity = msg.data[2]
                channel.note[noteNumber] = (velocity || 0) / 127
                lastInput = `Port ${idx} Channel ${channelNumber} Note ${noteNumber}`
                if (cmd === 9) {
                  for (let k in channel.listeners) {
                    let listener = channel.listeners[k]
                    listener(noteNumber || 0, (velocity || 0) / 127)
                  }
                }
              }
              if (cmd === 13) { // Aftertouch
                var velocity = msg.data[1]
                for (let n in channel.note) {
                  if (channel.note[n] > 0) {
                    channel.note[n] = (velocity || 0) / 127
                  }
                }                
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
    if (!!controlId && channel.controller[controlId]) { return channel.controller[controlId] }
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

  return {
    getValue: getValue,
    connect: connect,
    getLastInputString: getLastInputString,
    listen: listen,
    stopListening: midIgnore,
  }
})