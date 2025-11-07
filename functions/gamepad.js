'use strict'
define(function(require) {
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  let invertY = true
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
      else if (str === 'lsh') { axisNumber = 0 } // left stick horizontal
      else if (str === 'lsv') { axisNumber = 1 } // left stick vertical
      else if (str === 'rsh') { axisNumber = 2 } // right stick horizontal
      else if (str === 'rsv') { axisNumber = 3 } // right stick vertical
      else if (str === 'lsl') { axisNumber = 0; axisRange = 'neg' } // left stick left
      else if (str === 'lsr') { axisNumber = 0; axisRange = 'pos' } // left stick right
      else if (str === 'lsd') { axisNumber = 1; axisRange = 'pos' } // left stick down
      else if (str === 'lsu') { axisNumber = 1; axisRange = 'neg' } // left stick up
      else if (str === 'lsud') { axisNumber = 1; axisRange = 'both' } // left stick up or down
      else if (str === 'lsdu') { axisNumber = 1; axisRange = 'both' } // left stick up or down
      else if (str === 'lslr') { axisNumber = 0; axisRange = 'both' } // left stick left or right
      else if (str === 'lsrl') { axisNumber = 0; axisRange = 'both' } // left stick left or right
      else if (str === 'lsx') { axisNumber = 0; axisRange = 'radial' } // left stick radial
      else if (str === 'rsl') { axisNumber = 2; axisRange = 'neg' } // right stick left
      else if (str === 'rsr') { axisNumber = 2; axisRange = 'pos' } // right stick right
      else if (str === 'rsd') { axisNumber = 3; axisRange = 'pos' } // right stick down
      else if (str === 'rsu') { axisNumber = 3; axisRange = 'neg' } // right stick up
      else if (str === 'rsud') { axisNumber = 3; axisRange = 'both' } // right stick up or down
      else if (str === 'rsdu') { axisNumber = 3; axisRange = 'both' } // right stick up or down
      else if (str === 'rslr') { axisNumber = 2; axisRange = 'both' } // right stick left or right
      else if (str === 'rsrl') { axisNumber = 2; axisRange = 'both' } // right stick left or right
      else if (str === 'rsx') { axisNumber = 2; axisRange = 'radial' } // right stick radial
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
      if (invertY && (axisNumber === 1 || axisNumber === 3)) { axisValue = -axisValue }
      if (axisRange === 'neg') { axisValue = Math.max(0, -axisValue) }
      else if (axisRange === 'pos') { axisValue = Math.max(0, axisValue) }
      else if (axisRange === 'both') { axisValue = Math.abs(axisValue) }
      else if (axisRange === 'radial') {
        let perpAxisValue = gamepad.axes[(axisNumber || 0)+1] || 0
        axisValue = Math.sqrt(axisValue*axisValue + perpAxisValue*perpAxisValue)
      }
      return axisValue
    }
    gamepadValue.isNonTemporal = true
    gamepadValue.interval = 'frame'
    gamepadValue._name = 'gamepad'
    return gamepadValue
  }
  newGamepad.isStaticVarFunction = true
  newGamepad._name = 'gamepad'

  // Handy shortcuts so you can just write `gp.lsr` etc
  newGamepad.lt = newGamepad.bind(null, {value: 'lt'})
  newGamepad.rt = newGamepad.bind(null, {value: 'rt'})
  newGamepad.lsh = newGamepad.bind(null, {value: 'lsh'})
  newGamepad.lsv = newGamepad.bind(null, {value: 'lsv'})
  newGamepad.rsh = newGamepad.bind(null, {value: 'rsh'})
  newGamepad.rsv = newGamepad.bind(null, {value: 'rsv'})
  newGamepad.lsl = newGamepad.bind(null, {value: 'lsl'})
  newGamepad.lsr = newGamepad.bind(null, {value: 'lsr'})
  newGamepad.lsu = newGamepad.bind(null, {value: 'lsu'})
  newGamepad.lsd = newGamepad.bind(null, {value: 'lsd'})
  newGamepad.lsud = newGamepad.bind(null, {value: 'lsud'})
  newGamepad.lsdu = newGamepad.bind(null, {value: 'lsdu'})
  newGamepad.lslr = newGamepad.bind(null, {value: 'lslr'})
  newGamepad.lsrl = newGamepad.bind(null, {value: 'lsrl'})
  newGamepad.lsx = newGamepad.bind(null, {value: 'lsx'})
  newGamepad.rsl = newGamepad.bind(null, {value: 'rsl'})
  newGamepad.rsr = newGamepad.bind(null, {value: 'rsr'})
  newGamepad.rsu = newGamepad.bind(null, {value: 'rsu'})
  newGamepad.rsd = newGamepad.bind(null, {value: 'rsd'})
  newGamepad.rsud = newGamepad.bind(null, {value: 'rsud'})
  newGamepad.rsdu = newGamepad.bind(null, {value: 'rsdu'})
  newGamepad.rslr = newGamepad.bind(null, {value: 'rslr'})
  newGamepad.rsrl = newGamepad.bind(null, {value: 'rsrl'})
  newGamepad.rsx = newGamepad.bind(null, {value: 'rsx'})

  addVar('gamepad', newGamepad)
  addVar('gp', newGamepad) // Alias for ease of access
})