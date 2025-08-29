'use strict'
define(function(require) {
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  let blankArgs = {}
  let newGamepad = (args, context) => {
    args = args || blankArgs
    let buttonNumber = args.button
    let axisNumber = args.axis
    let axisRange = 'full'
    let requireStandardMapping = false
    let padNumber = args.pad !== undefined ? args.pad : args.value1
    if (typeof args.value === 'string') {
      requireStandardMapping = true
      let str = args.value.toLowerCase().trim()
      if (str === 'lt') { buttonNumber = 6 } // left trigger
      else if (str === 'rt') { buttonNumber = 7 } // right trigger
      else if (str === 'lsl') { axisNumber = 0; axisRange = 'neg' } // left stick left
      else if (str === 'lsr') { axisNumber = 0; axisRange = 'pos' } // left stick right
      else if (str === 'lsd') { axisNumber = 1; axisRange = 'neg' } // left stick up
      else if (str === 'lsu') { axisNumber = 1; axisRange = 'pos' } // left stick down
      else if (str === 'rsl') { axisNumber = 2; axisRange = 'neg' } // right stick left
      else if (str === 'rsr') { axisNumber = 2; axisRange = 'pos' } // right stick right
      else if (str === 'rsd') { axisNumber = 3; axisRange = 'neg' } // right stick up
      else if (str === 'rsu') { axisNumber = 3; axisRange = 'pos' } // right stick down
    } else if (axisNumber === undefined) { axisNumber = args.value }
    let lastStr
    let gamepadValue = () => {
      if (padNumber === undefined && axisNumber === undefined && buttonNumber === undefined) { // log gamepad info if no params
        let str = 'Gamepads:\n'
        navigator.getGamepads().forEach((pad, i) => {
          if (!pad) { return 0 }
          str += `Pad ${i} ${pad.id} ${pad.mapping}:\n`
          str += `axes: ${pad.axes.join(', ')} `
          str += `buttons: ${pad.buttons.map(b => b.value).join(', ')}`
          str += '\n'
        })
        if (lastStr != str) { consoleOut(str) }
        lastStr = str
        return 0
      }
      let gamepad = navigator.getGamepads()[padNumber || 0]
      if (!gamepad) { return 0 }
      if (requireStandardMapping && gamepad.mapping !== 'standard') { consoleOut('🔴 named gamepad axes will not work correctly on non-standard mapping gamepad!') }
      if (buttonNumber !== undefined) { return gamepad.buttons[buttonNumber].value || 0 }
      let axisValue = gamepad.axes[axisNumber || 0] || 0
      if (axisRange === 'neg') { axisValue = Math.max(0, -axisValue) }
      else if (axisRange === 'pos') { axisValue = Math.max(0, axisValue) }
      return axisValue
    }
    gamepadValue.isNonTemporal = true
    gamepadValue.interval = 'frame'
    return gamepadValue
  }
  newGamepad.isStaticVarFunction = true
  addVar('gamepad', newGamepad)
})