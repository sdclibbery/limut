'use strict';
define(function (require) {
  let {addRenderer,blendChannel} = require('draw/dmx-system')
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')
  let {mainParamUnits} = require('player/sub-param')
  let {colourRgb} = require('draw/colour')

  let evalMainParamEvent = (params, p, def, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }

  let numberArray = [0]
  let values = []
  let black = {r:0,g:0,b:0,a:1}
  let convertValues = (v) => {
    if (Array.isArray(v)) { return v.filter(av => typeof av === 'number') }
    if (typeof v === 'object') {
      let col = colourRgb(v, black, 'lights')
      if (Array.isArray(col)) {
        values[0] = col[0]
        values[1] = col[1]
        values[2] = col[2]
        return values
      }
      if (typeof v.value === 'number') { values[0] = v.value }
      if (typeof v.value1 === 'number') { values[1] = v.value1 }
      if (typeof v.value2 === 'number') { values[2] = v.value2 }
      if (typeof v.value3 === 'number') { values[3] = v.value3 }
      if (typeof v.x === 'number') { values[0] = v.x }
      if (typeof v.y === 'number') { values[1] = v.y }
      if (typeof v.z === 'number') { values[2] = v.z }
      if (typeof v.w === 'number') { values[3] = v.w }
      return values
    }
    if (typeof v === 'number') { numberArray[0] = v; return numberArray }
    return []
  }

  let applyParam = (value, baseChannel, blend) => {
    if (!value) { return }
    if (typeof value === 'object') {
      for (let key in value) {
        let channel
        if (key.startsWith('value')) {
          channel = (parseInt(key.slice(5)) || 0) + 1 // Force to 1-based
        } else {
          channel = parseInt(key) // Numeric keys
        }
        if (!isNaN(channel)) {
          channel += baseChannel - 1 // Base channel is 1-based
          convertValues(value[key]).forEach((v, valueIdx) => { // If evalled was a colour or something, write all values
            blendChannel(channel + valueIdx, v, blend)
          })
        }
      }
    } else if (typeof value === 'number') {
      blendChannel(baseChannel, value, blend.toLowerCase())
    }
}

  return (params) => {
    let dur = evalMainParamEvent(params, 'dur', 1, 'b')
    let sus = evalMainParamEvent(params, 'sus', dur, 'b')
    params.endTime = params._time + sus * params.beat.duration
    let baseChannel = evalParamEvent(params.channel, params) || 1 // Base channel offset (which must also be 1-based)
    let zOrder = 0
    addRenderer(params._time, ({time, count}) => {
      if (time > params.endTime) { return false }
      applyParam(evalParamFrame(params.lights, params, count), baseChannel, 'add')
      applyParam(evalParamFrame(params.add, params, count), baseChannel, 'add')
      applyParam(evalParamFrame(params.sub, params, count), baseChannel, 'sub')
      applyParam(evalParamFrame(params.set, params, count), baseChannel, 'set')
      applyParam(evalParamFrame(params.mul, params, count), baseChannel, 'mul')
      applyParam(evalParamFrame(params.min, params, count), baseChannel, 'min')
      applyParam(evalParamFrame(params.max, params, count), baseChannel, 'max')
      return true
    }, zOrder)
  }
})
