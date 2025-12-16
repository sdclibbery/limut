'use strict'
define(function(require) {
  let consoleOut = require('console')
  let addVar = require('predefined-vars').add

  let namedAxes = {
    lt : { button: 6 }, // left trigger
    rt : { button: 7 }, // right trigger
    lsh : { axis: 0 }, // left stick horizontal
    lsv : { axis: 1 }, // left stick vertical
    rsh : { axis: 2 }, // right stick horizontal
    rsv : { axis: 3 }, // right stick vertical
    lsl : { axis: 0, range: 'neg' }, // left stick left
    lsr : { axis: 0, range: 'pos' }, // left stick right
    lsd : { axis: 1, range: 'neg' }, // left stick down
    lsu : { axis: 1, range: 'pos' }, // left stick up
    lsud : { axis: 1, range: 'both' }, // left stick up or down
    lsdu : { axis: 1, range: 'both' }, // left stick up or down
    lslr : { axis: 0, range: 'both' }, // left stick left or right
    lsrl : { axis: 0, range: 'both' }, // left stick left or right
    lsx : { axis: 0, range: 'radial' }, // left stick radial
    rsl : { axis: 2, range: 'neg' }, // right stick left
    rsr : { axis: 2, range: 'pos' }, // right stick right
    rsd : { axis: 3, range: 'neg' }, // right stick down
    rsu : { axis: 3, range: 'pos' }, // right stick up
    rsud : { axis: 3, range: 'both' }, // right stick up or down
    rsdu : { axis: 3, range: 'both' }, // right stick up or down
    rslr : { axis: 2, range: 'both' }, // right stick left or right
    rsrl : { axis: 2, range: 'both' }, // right stick left or right
    rsx : { axis: 2, range: 'radial' }, // right stick radial
  }

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
      let axis = namedAxes[str]
      if (axis && axis.axis !== undefined) { axisNumber = axis.axis } else { axisNumber = args.value }
      if (axis && axis.button !== undefined) { axisButton = axis.button }
      if (axis && axis.range !== undefined) { axisRange = axis.range }
    }
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
      else if (axisRange === 'both') { axisValue = Math.abs(axisValue) }
      else if (axisRange === 'radial') {
        let perpAxisValue = gamepad.axes[(axisNumber || 0)+1] || 0
        axisValue = Math.max(Math.abs(axisValue), Math.abs(perpAxisValue))
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
  for (let key in namedAxes) {
    newGamepad[key] = newGamepad.bind(null, {value: key})
  }

  addVar('gamepad', newGamepad)
  addVar('gp', newGamepad) // Alias for ease of access
})