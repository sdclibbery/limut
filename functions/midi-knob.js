'use strict'
define(function(require) {
  let midi = require('midi')
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  let blankArgs = {}
  let newMidiKnob = (args, context) => {
    args = args || blankArgs
    let portNumber = args.port
    let controlId = args.control || args.value
    let noteNumber = args.note || args.value
    let channelNumber = args.channel || args.value1
    let lastLastInput
    let midiKnobValue = () => {
      if (portNumber === undefined && channelNumber === undefined && controlId === undefined && noteNumber === undefined) {
        // If no args, dump last input to help identify
        let lastInput = midi.getLastInputString()
        if (lastInput !== lastLastInput) { consoleOut(lastInput) }
        lastLastInput = lastInput
      }
      return midi.getValue(portNumber || 0, channelNumber || 0, controlId || 0, noteNumber || 0)
    }
    midiKnobValue.interval = 'frame'
    return midiKnobValue
  }

  newMidiKnob.isStaticVarFunction = true
  addVar('midi', newMidiKnob)
})