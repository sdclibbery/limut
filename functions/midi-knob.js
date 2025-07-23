'use strict'
define(function(require) {
  let {midiValue,midiLastInput} = require('midi')
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
    return () => {
      if (portNumber === undefined && channelNumber === undefined && controlId === undefined && noteNumber === undefined) { // If no args, dump last input to help identify
        let lastInput = midiLastInput()
        if (lastInput !== lastLastInput) { consoleOut(lastInput) }
        lastLastInput = lastInput
      }
      return midiValue(portNumber || 0, channelNumber || 0, controlId || 0, noteNumber || 0)
    }
  }

  newMidiKnob.isStaticVarFunction = true
  newMidiKnob.interval = 'frame'
  addVar('midi', newMidiKnob)
})