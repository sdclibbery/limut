'use strict';
define(function (require) {
  let {addRenderer,addToChannel} = require('dmx')
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')
  let {mainParamUnits} = require('player/sub-param')

  let evalMainParamEvent = (params, p, def, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }

  let numbeArray = [0]
  let convertValues = (v) => {
    if (Array.isArray(v)) { return v.filter(av => typeof av === 'number') }
    if (typeof v === 'object') {
      let values = []
      if (typeof v.value === 'number') { values[0] = v.value }
      if (typeof v.value1 === 'number') { values[1] = v.value1 }
      if (typeof v.value2 === 'number') { values[2] = v.value2 }
      if (typeof v.value3 === 'number') { values[3] = v.value3 }
      if (typeof v.r === 'number') { values[0] = v.r }
      if (typeof v.g === 'number') { values[1] = v.g }
      if (typeof v.b === 'number') { values[2] = v.b }
      if (typeof v.w === 'number') { values[3] = v.w }
      if (typeof v.x === 'number') { values[0] = v.x }
      if (typeof v.y === 'number') { values[1] = v.y }
      if (typeof v.z === 'number') { values[2] = v.z }
      return values
    }
    if (typeof v === 'number') { numbeArray[0] = v; return numbeArray }
    return []
  }

  return (params) => {
    let dur = evalMainParamEvent(params, 'dur', 1, 'b')
    let sus = evalMainParamEvent(params, 'sus', dur, 'b')
    params.endTime = params._time + sus * params.beat.duration
    let baseChannel = evalParamEvent(params.channel, params) || 1 // Base channel offset (which must also be 1-based)
    let zOrder = 0
    addRenderer(params._time, ({time}) => {
      if (time > params.endTime) { return false }
      let lights = evalParamFrame(params.lights, params, time)
      if (typeof lights === 'object') {
        for (let key in lights) {
          let channel
          if (key.startsWith('value')) {
            channel = (parseInt(key.slice(5)) || 0) + 1 // Force to 1-based
          } else {
            channel = parseInt(key) // Numeric keys
          }
          if (!isNaN(channel)) {
            channel += baseChannel - 1 // Base channel is 1-based
            convertValues(lights[key]).forEach((v, valueIdx) => { // If evalled was a colour or something, write all values
              addToChannel(channel + valueIdx, Math.floor(Math.min(Math.max(v, 0), 1) * 255))
            })
          }
        }
      }
      return true
    }, zOrder)
  }
})
