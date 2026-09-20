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
    pressure: 0,      // Channel pressure (0xD0): one value for the whole channel
    notePressure: {}, // Polyphonic key pressure (0xA0): noteNumber -> pressure
  } }

  let midi
  let connecting = false
  let inputs = []
  let portIndexes = {} // MIDIInput.id -> the port number limut knows it by
  let portInfo = [] // Per port number: which device it is, and whether it is currently plugged in
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
      channel.pressure = 0
      channel.notePressure = {}
      held.forEach(noteNumber => {
        for (let k in channel.listeners) {
          channel.listeners[k](noteNumber, undefined) // Note off notified with undefined velocity
        }
      })
    }
  }

  let handleMessage = (idx, msg) => {
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
        channel.notePressure[noteNumber] = 0 // A fresh press starts from no pressure
        for (let k in channel.listeners) {
          let listener = channel.listeners[k]
          listener(noteNumber || 0, velocity || 0)
        }
      } else { // Note off
        channel.notes = channel.notes.filter((n) => n !== noteNumber)
        delete channel.notePressure[noteNumber]
        if (channel.notes.length === 0) { channel.vel = 0; channel.pressure = 0 }
        for (let k in channel.listeners) {
          let listener = channel.listeners[k]
          listener(noteNumber || 0, undefined) // Note off notified with undefined velocity
        }
      }
    }
    if (cmd === 10) { // Polyphonic key pressure: aftertouch for one note
      var noteNumber = msg.data[1]
      var pressure = msg.data[2] / 127
      channel.notePressure[noteNumber] = pressure || 0
      if (channel.notes.includes(noteNumber)) { channel.note[noteNumber] = pressure || 0 } // As channel pressure does: the note value follows the pressure once it arrives
      channel.vel = pressure || 0
      lastInput = `Port ${idx} Channel ${channelNumber} Key pressure ${noteNumber}`
    }
    if (cmd === 13) { // Channel pressure (aftertouch)
      var aftertouch = msg.data[1] / 127
      // Driven off the held list, not `channel.note[n] > 0`: pressure that falls to 0 would take
      // that note out of this loop for good, and it could never be raised again
      channel.notes.forEach(n => { channel.note[n] = aftertouch || 0 })
      channel.pressure = aftertouch || 0
      channel.vel = aftertouch || 0
      lastInput = `Port ${idx} Channel ${channelNumber} Aftertouch`
    }
  }

  // A device that is unplugged and plugged back in keeps the port number it had, so inputs[idx] -
  // and every listener registered against it - survives the round trip, and live code reading that
  // port carries on working without being re-run.
  let registerPort = (port) => {
    let idx = portIndexes[port.id]
    if (idx === undefined) {
      idx = portInfo.length
      portIndexes[port.id] = idx
    }
    portInfo[idx] = { id: port.id, name: port.name, manufacturer: port.manufacturer, connected: true }
    consoleOut(`🔵 MIDI port ${idx}: ${port.manufacturer} ${port.name}`)
    port.open().then(() => { port.onmidimessage = (msg) => handleMessage(idx, msg) })
    return idx
  }

  let connect = () => {
    if (connecting) { return }
    connecting = true
    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        midi = midiAccess
        midi.onstatechange = (event) => {
          let port = event.port
          if (!port || port.type !== 'input') { return }
          if (port.state === 'connected') { // Plugged in after startup: open it now, or it never sends us anything
            let idx = portIndexes[port.id]
            if (idx !== undefined && portInfo[idx] && portInfo[idx].connected) { return } // Already open; statechange also fires when we open a port ourselves
            registerPort(port)
            return
          }
          if (port.state !== 'disconnected') { return }
          let idx = portIndexes[port.id]
          if (idx === undefined) { return }
          consoleOut(`🟠 MIDI port ${idx} disconnected: ${port.manufacturer} ${port.name}`)
          if (portInfo[idx]) { portInfo[idx].connected = false }
          releasePort(idx)
        }
        midi.inputs.forEach((port) => { registerPort(port) })
      },
      () => { consoleOut('🔴 No midi access available') }
    )
  }

  // Recognise a device by name, eg 'vortex' for the keytar. A string, or a list of alternatives.
  let matchesPort = (info, matcher) => {
    if (!info) { return false }
    let haystack = `${info.manufacturer || ''} ${info.name || ''}`.toLowerCase()
    return [matcher].flat().some(m => haystack.includes((''+m).toLowerCase()))
  }

  let findPort = (matcher) => {
    if (!midi) { connect() }
    for (let idx = 0; idx < portInfo.length; idx++) {
      if (portInfo[idx] && portInfo[idx].connected && matchesPort(portInfo[idx], matcher)) { return idx }
    }
    return undefined
  }

  let getPorts = () => {
    if (!midi) { connect() }
    return portInfo.map(i => i && Object.assign({}, i))
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
    if (controlId === 'press') { return channel.pressure || 0 }
    if (controlId !== undefined && channel.controller[controlId] !== undefined) { return channel.controller[controlId] }
    return channel.note[noteNumber] || 0
  }

  // Aftertouch for one note, whichever kind the device sends: a device sends polyphonic key
  // pressure or channel pressure, not both, so the max is simply "whichever arrived".
  let getPressure = (portNumber, channelNumber, noteNumber) => {
    if (!midi) { connect() }
    let port = inputs[portNumber]
    if (!port) { return 0 }
    let channel = port[channelNumber]
    if (!channel) { return 0 }
    return Math.max(channel.notePressure[noteNumber] || 0, channel.pressure || 0)
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

  let stubPort = (id, name, manufacturer) => { return {
    id: id, name: name, manufacturer: manufacturer, type: 'input', state: 'connected',
    open: function() { return Promise.resolve(this) },
  } }
  let resetPorts = () => {
    inputs.length = 0
    portInfo.length = 0
    for (let k in portIndexes) { delete portIndexes[k] }
  }
  // Ports are only ever added, so the tests below run on a clean slate and put it back afterwards
  resetPorts()
  let realMidi = midi
  midi = midi || {} // Keep the lazy connect() out of the tests; real midi access is restored below

  { // Ports get consecutive numbers, and a device that comes back keeps the one it had
    let a = stubPort('a', 'Vortex Wireless 2', 'Alesis')
    let b = stubPort('b', 'nanoKONTROL2', 'KORG')
    assert(0, registerPort(a))
    assert(1, registerPort(b))
    inputs[0] = {0: createinputChannel()}
    inputs[0][0].listeners['p1'] = () => {}
    portInfo[0].connected = false // As a disconnect leaves it
    assert(0, registerPort(a), 'the same device gets its old port number back')
    assert(true, portInfo[0].connected, 'and is marked plugged in again')
    assert(true, inputs[0][0].listeners['p1'] !== undefined, 'its listeners survived the round trip')
    assert(2, portInfo.length, 'no extra port was invented for it')
  }

  { // findPort recognises a device by name or manufacturer, and only while it is plugged in
    assert(0, findPort('vortex'))
    assert(0, findPort('VORTEX'), 'case insensitive')
    assert(0, findPort('alesis'), 'matches the manufacturer too')
    assert(0, findPort(['nothing', 'vortex']), 'a list of alternatives')
    assert(1, findPort('nanokontrol'))
    assert(undefined, findPort('novation'), 'no such device')
    portInfo[0].connected = false
    assert(undefined, findPort('vortex'), 'unplugged devices do not match')
    portInfo[0].connected = true
  }

  { // A message on a port lands on the right channel and control
    handleMessage(1, {data: [0xb0, 74, 127]}) // Controller 74 on channel 0
    assert(1, getValue(1, 0, 74))
    assert(0, getValue(1, 1, 74), 'a different channel')
    assert(0, getValue(7, 0, 74), 'a port with no input yet')
  }

  { // Aftertouch: stored in its own right, per note, whichever kind the device sends
    let idx = 5
    let msg = (...data) => handleMessage(idx, {data: data})
    msg(0x90, 60, 127) // Two notes held on channel 0
    msg(0x90, 64, 64)
    assert(1, getValue(idx, 0, undefined, 60), 'the note on velocity')
    assert(0, getPressure(idx, 0, 60), 'no pressure until some arrives')

    msg(0xd0, 64) // Channel pressure reaches every held note
    assert(64/127, getPressure(idx, 0, 60))
    assert(64/127, getPressure(idx, 0, 64), 'and the other held note')
    assert(64/127, getValue(idx, 0, 'press'), "midi{'press'}")
    assert(64/127, getValue(idx, 0, 'vel'), "midi{'vel'} follows the aftertouch")
    assert(64/127, getValue(idx, 0, undefined, 60), 'so does the note value, as documented')

    msg(0xd0, 0) // Pressure that falls away must be able to come back: the note stays in the loop
    assert(0, getPressure(idx, 0, 60))
    msg(0xd0, 127)
    assert(1, getPressure(idx, 0, 60), 'a note whose pressure reached 0 still tracks')

    msg(0x91, 60, 127) // Polyphonic key pressure, on a channel of its own
    msg(0x91, 64, 127)
    msg(0xa1, 60, 32)
    assert(32/127, getPressure(idx, 1, 60))
    assert(0, getPressure(idx, 1, 64), 'another held note is untouched by key pressure')
    assert(0, getValue(idx, 1, 'press'), 'key pressure is not channel pressure')
    msg(0xd1, 16) // Both kinds at once: whichever is higher is the one that arrived
    assert(32/127, getPressure(idx, 1, 60))
    assert(16/127, getPressure(idx, 1, 64))

    msg(0x81, 60, 0) // A released note keeps no key pressure of its own
    assert(16/127, getPressure(idx, 1, 60), 'only the channel pressure is left, which is still channel wide')
    msg(0x81, 64, 0)
    assert(0, getValue(idx, 1, 'press'), 'the last note lifting clears the channel pressure')
    assert(0, getPressure(idx, 1, 60), 'and now there is nothing left at all')
    assert(1, getValue(idx, 0, 'press'), 'the other channel is unaffected')

    assert(0, getPressure(99, 0, 60), 'an unknown port')
    assert(0, getPressure(idx, 9, 60), 'an unknown channel')

    releasePort(idx) // A port that goes away drops its pressure with everything else
    assert(0, getPressure(idx, 0, 60))
    assert(0, getValue(idx, 0, 'press'))
    delete inputs[idx]
  }

  resetPorts()
  midi = realMidi

  console.log('Midi tests complete')
  }

  return {
    getValue: getValue,
    getPressure: getPressure,
    connect: connect,
    getLastInputString: getLastInputString,
    listen: listen,
    stopListening: midIgnore,
    registerPort: registerPort,
    findPort: findPort,
    getPorts: getPorts,
  }
})
