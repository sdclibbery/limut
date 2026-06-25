'use strict';
define(function (require) {
  let {addRenderer,blendChannel} = require('draw/dmx-system')
  let {evalParamEvent,evalParamFrame} = require('player/eval-param')
  let {mainParamUnits} = require('player/sub-param')
  let {isColour,colourRgb} = require('draw/colour')
  let system = require('draw/system')

  let evalMainParamEvent = (params, p, def, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }

  // A segmented (@s) timevar value arrives wrapped with segment metadata the audio scheduler
  // uses but the per-frame renderer does not. When it wraps a scalar the real value is in
  // .value; unwrap it so it isn't misread as a (black) colour by convertValues. The colour-
  // merged shape ({r,g,b,_nextSegment}) has no .value and is left for the colour path.
  let unwrapSegment = (v) =>
    (v && typeof v === 'object' && v._nextSegment !== undefined && v.value !== undefined)
      ? v.value : v

  let numberArray = [0]
  let values = []
  let black = {r:0,g:0,b:0,a:1}
  let convertValues = (v) => {
    v = unwrapSegment(v)
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
    value = unwrapSegment(value)
    if (typeof value === 'object') {
      if (isColour(value)) { // param is just a colour
        convertValues(value).forEach((v, valueIdx) => {
          blendChannel(baseChannel + valueIdx, v, blend)
        })
        return
      }
      let cumulativeChannel = 0
      for (let key in value) {
        if (key.startsWith('value')) { // Treat as an array; assign channels on a cumulative basis
          convertValues(value[key]).forEach((v, valueIdx) => { // If evalled was a colour or something, write all values
            blendChannel(cumulativeChannel + baseChannel, v, blend) // Base channel is 1-based, so channel becomes an absolute 1-based dmx channel number after this
            cumulativeChannel += 1
          })
        } else {
          let channel = parseInt(key) // Specific numeric keys
          if (isNaN(channel)) { continue }
          convertValues(value[key]).forEach((v, valueIdx) => { // If evalled was a colour or something, write all values
            blendChannel(channel + valueIdx + baseChannel, v, blend) // Base channel is 1-based, so channel becomes an absolute 1-based dmx channel number after this
            cumulativeChannel = channel + valueIdx
          })
        }
      }
    } else if (typeof value === 'number') {
      blendChannel(baseChannel, value, blend)
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    let assert = (expected, actual) => {
      let x = JSON.stringify(expected)
      let a = JSON.stringify(actual)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    // Scalar segment wrapper (@s timevar like duck) unwraps to its underlying value
    assert(0.5, unwrapSegment({value:0.5,_nextSegment:1,_segmentPower:3}))
    assert(0, unwrapSegment({value:0,_nextSegment:1,_segmentPower:3})) // 0 must not be lost
    // Colour-merged segment shape has no .value: left untouched for the colour path
    assert({r:1,g:0,b:0,_nextSegment:1,_segmentPower:1}, unwrapSegment({r:1,g:0,b:0,_nextSegment:1,_segmentPower:1}))
    // Plain values pass through unchanged
    assert(0.7, unwrapSegment(0.7))
    assert({r:1,g:0}, unwrapSegment({r:1,g:0}))
    console.log('DMX tests complete')
  }

  return (params) => {
    let dur = evalMainParamEvent(params, 'dur', 1, 'b')
    let sus = evalMainParamEvent(params, 'sus', dur, 'b')
    if (params._noteOff === undefined) {
      params.endTime = params._time + sus * params.beat.duration
    } else { // "live" envelope, use note off to determine when to release
      params.endTime = params._time + 1e6
      params._noteOff = () => { params.endTime = system.time+0.01 } // Set real end time to end the event
    }
    let zOrder = 0
    addRenderer(params._time, ({time, count}) => {
      if (time > params.endTime) { return false }
      let baseChannel = evalParamFrame(params.channel, params, count) || 1 // Base channel offset: dmx is 1-based
      applyParam(evalParamFrame(params.lights, params, count), baseChannel, 'add')
      applyParam(evalParamFrame(params.addl, params, count), baseChannel, 'add')
      applyParam(evalParamFrame(params.sub, params, count), baseChannel, 'sub')
      applyParam(evalParamFrame(params.set, params, count), baseChannel, 'set')
      applyParam(evalParamFrame(params.mul, params, count), baseChannel, 'mul')
      applyParam(evalParamFrame(params.min, params, count), baseChannel, 'min')
      applyParam(evalParamFrame(params.max, params, count), baseChannel, 'max')
      return true
    }, zOrder)
  }
})
