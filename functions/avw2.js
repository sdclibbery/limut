'use strict'
define(function(require) {
  let midi = require('midi')
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  // The Alesis Vortex Wireless 2 keytar, however it turns up: over USB, or via its wireless receiver
  let deviceNames = ['vortex']

  // Everything the keytar sends, on midi channel 0 (which the Alesis editor calls "Channel 1").
  // Reprogrammed the keytar in the preset editor? This table is the only thing to change.
  let controls = {
    s1: {control:7}, // Volume slider on the neck
    bend: {control:'bend'},
    ribbon: {control:1}, // Touch ribbon, bank 1
    ribbon1: {control:1},
    ribbon3: {control:22}, // Touch ribbon, bank 3. Bank 2 is unmapped
    sus: {control:64},
    // No tilt: the accelerometer sends controller 1, the same as the ribbon, so it is not its own control
    notes: {control:'notes'}, // Chord of the keys currently held
    vel: {control:'vel'},
    press: {control:'press'},
    connected: {special:'connected'}, // 1 when the keytar is plugged in, 0 when it is not
  }
  for (let i = 1; i <= 8; i++) {
    controls['f'+i] = {control: 13+i} // Faders f1-f8: controllers 14-21
    controls['p'+i] = {note: 35+i} // Pads p1-p8: notes 36-43
  }

  let describe = (port) => {
    let str = 'Midi ports:\n'
    midi.getPorts().forEach((info, i) => {
      if (!info) { return }
      str += `  ${i}: ${info.manufacturer} ${info.name}${info.connected ? '' : ' (disconnected)'}\n`
    })
    str += port === undefined ? '🔴 No Alesis Vortex Wireless 2 found\n' : `🎸 Alesis Vortex Wireless 2 on port ${port}\n`
    let lastInput = midi.getLastInputString()
    if (lastInput) { str += `Last input: ${lastInput}` }
    return str
  }

  let blankArgs = {}
  let newAvw2 = (args, context) => {
    args = args || blankArgs
    let name = typeof args.value === 'string' ? args.value.toLowerCase().trim() : undefined
    let mapped = name !== undefined ? controls[name] : undefined
    if (name !== undefined && mapped === undefined) { consoleOut(`🔴 Unknown avw2 control '${name}'`) }
    let controlId = args.control
    let noteNumber = args.note
    let special = mapped !== undefined ? mapped.special : undefined
    if (mapped !== undefined) {
      if (mapped.control !== undefined) { controlId = mapped.control }
      if (mapped.note !== undefined) { noteNumber = mapped.note }
    } else if (typeof args.value === 'number' && controlId === undefined && noteNumber === undefined) {
      controlId = args.value // avw2{14}: a raw control (or note) number, like midi{14} but on its port
      noteNumber = args.value
    }
    let channelNumber = args.channel !== undefined ? args.channel : 0
    let portOverride = args.port
    // With no args at all, report what is plugged in and what it last sent, to help identify controls
    let isBare = special === undefined && controlId === undefined && noteNumber === undefined && portOverride === undefined
    let lastLog
    let avw2Value = () => {
      // Resolved every frame, not once at parse time, so a keytar plugged in later starts working
      // without the line having to be re-run
      let portNumber = portOverride !== undefined ? portOverride : midi.findPort(deviceNames)
      if (isBare) {
        let log = describe(portNumber)
        if (log !== lastLog) { consoleOut(log) }
        lastLog = log
      }
      if (isBare || special === 'connected') { return portNumber === undefined ? 0 : 1 }
      if (portNumber === undefined) { return 0 }
      return midi.getValue(portNumber, channelNumber, controlId, noteNumber)
    }
    avw2Value.isNonTemporal = true
    avw2Value.interval = 'frame'
    avw2Value._name = 'avw2'
    return avw2Value
  }
  newAvw2.isStaticVarFunction = true
  newAvw2._name = 'avw2'
  newAvw2.interval = 'frame'

  // Hang every control on the function so you can just write `avw2.f1`
  for (let key in controls) { newAvw2[key] = newAvw2.bind(null, {value: key}) }

  addVar('avw2', newAvw2)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual, msg) => {
    if (expected !== actual) { console.trace(`Assertion failed.\n>>Expected: ${expected}\n>>Actual: ${actual}${msg?'\n'+msg:''}`) }
  }

  // Stand in for the midi module so the mapping can be checked with no hardware
  let realMidi = {getValue: midi.getValue, findPort: midi.findPort, getPorts: midi.getPorts, getLastInputString: midi.getLastInputString}
  let calls
  let fakeMidi = (foundPort) => {
    calls = []
    midi.findPort = (matcher) => { calls.push(['findPort', ''+matcher]); return foundPort }
    midi.getValue = (p,c,id,note) => { calls.push(['getValue', p, c, id, note]); return 0.5 }
    midi.getPorts = () => []
    midi.getLastInputString = () => undefined
  }
  let lastCall = () => ''+calls[calls.length-1]

  { // A named control reads the control number the keytar is mapped to, on its own port
    fakeMidi(3)
    assert(0.5, newAvw2({value:'f1'})())
    assert('getValue,3,0,14,', lastCall(), 'fader 1 is controller 14')
    newAvw2({value:'f8'})()
    assert('getValue,3,0,21,', lastCall(), 'fader 8 is controller 21')
    newAvw2({value:'p3'})()
    assert('getValue,3,0,,38', lastCall(), 'pad 3 is note 38')
    newAvw2({value:'p8'})()
    assert('getValue,3,0,,43', lastCall(), 'pad 8 is note 43')
    newAvw2({value:'bend'})()
    assert('getValue,3,0,bend,', lastCall())
    newAvw2({value:'s1'})()
    assert('getValue,3,0,7,', lastCall(), 'the neck slider is controller 7')
    newAvw2({value:'press'})()
    assert('getValue,3,0,press,', lastCall())
    newAvw2({value:'sus'})()
    assert('getValue,3,0,64,', lastCall())
    newAvw2({value:'ribbon'})()
    assert('getValue,3,0,1,', lastCall())
    newAvw2({value:'ribbon3'})()
    assert('getValue,3,0,22,', lastCall())
    assert('findPort,vortex', ''+calls[0], 'the port is found by device name')
  }

  { // Explicit args: a raw control number, an explicit note, channel and port
    fakeMidi(3)
    newAvw2({value:14})()
    assert('getValue,3,0,14,14', lastCall(), 'a bare number is a control or note number, as for midi{}')
    newAvw2({control:70, channel:9})()
    assert('getValue,3,9,70,', lastCall())
    newAvw2({note:36})()
    assert('getValue,3,0,,36', lastCall())
    fakeMidi(3)
    newAvw2({value:'f1', port:5})()
    assert('getValue,5,0,14,', lastCall(), 'an explicit port overrides the auto detection')
    assert(0, calls.filter(c => c[0] === 'findPort').length, 'and does not go looking for the device')
  }

  { // With no keytar plugged in, reads are 0 rather than an error
    fakeMidi(undefined)
    assert(0, newAvw2({value:'f1'})())
    assert(0, newAvw2({value:'p1'})())
    assert(0, newAvw2({value:'connected'})())
    assert(0, calls.filter(c => c[0] === 'getValue').length, 'nothing is read from a port that is not there')
    fakeMidi(2)
    assert(1, newAvw2({value:'connected'})())
  }

  { // Every control is reachable as `avw2.<name>`, and updates per frame
    fakeMidi(0)
    for (let key in controls) {
      assert('function', typeof newAvw2[key], `avw2.${key} exists`)
      let value = newAvw2[key]() // As evalParamFrame calls it, then recurses on the result
      assert('function', typeof value, `avw2.${key} gives a value function`)
      assert('frame', value.interval, `avw2.${key} is re-read every frame`)
      assert('avw2', value._name, `avw2.${key} resolves through the avw2 namespace`)
    }
  }

  Object.assign(midi, realMidi)

  console.log('Avw2 tests complete')
  }
})
