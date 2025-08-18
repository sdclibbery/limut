'use strict'
define(function(require) {
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  let blankArgs = {}
  let newGamepad = (args, context) => {
    args = args || blankArgs
    let buttonNumber = args.button
    let axisNumber = args.axis !== undefined ? args.axis : args.value
    let padNumber = args.pad !== undefined ? args.pad : args.value1
    let lastStr
    let gamepadValue = () => {
      if (padNumber === undefined && axisNumber === undefined && buttonNumber === undefined) {
        let str = 'Gamepads:\n'
        navigator.getGamepads().forEach((pad, i) => {
          if (!pad) { return 0 }
          str += `Pad ${i}: `
          str += `axes: ${pad.axes.join(', ')} `
          str += `buttons: ${pad.buttons.map(b => b.value).join(', ')}`
          str += '\n'
        })
        if (lastStr != str) { consoleOut(str) }
        lastStr = str
        return 0
      }
      let gamepad = navigator.getGamepads()[padNumber || 0]
      if (buttonNumber !== undefined) { return gamepad && gamepad.buttons[buttonNumber].value || 0 }
      return gamepad && gamepad.axes[axisNumber || 0] || 0
    }
    gamepadValue.interval = 'frame'
    return gamepadValue
  }
  newGamepad.isStaticVarFunction = true
  addVar('gamepad', newGamepad)
})