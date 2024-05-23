'use strict';
define(function (require) {
  let evalParam = require('player/eval-param')
  let {mainParamUnits,subParamUnits} = require('player/sub-param')

  let evalParamPerFrame = (params, p, b, def) => {
    let v = params[p]
    v =  evalParam.evalParamFrame(v, params, b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
    if (Array.isArray(v)) { v = v[0] } // Bus chords end up as arrays here so handle it by just picking the first value
    if (typeof v !== 'number' && !v) {
      return def
    }
    return v
  }

  let getValue = (param, def, requiredUnits) => {
    return mainParamUnits(param, requiredUnits, def)
  }

  let empty = {}
  let getParamValue = (param, subP) => {
    if (param === undefined) { return empty }
    if (param !== empty && subP) { param = param[subP] } // Get sub Param if required
    if (param === undefined) { return empty }
    if (typeof param.value === 'object') { return param.value } // Get value within main param if needed
    return param
  }

  let applyMod = (v, mod) => mod === undefined ? v : mod(v)

  let segmentedAudioParam = (audioParam, params, p, subP, def, requiredUnits, mod) => { // !! ASSUME mod IS LINEAR
    let param = getParamValue(evalParamPerFrame(params, p, params.count, undefined), subP)
    if (param._nextSegment === undefined) { return false } // No segment data; we cant build a segment timeline here
// console.log(`Segmented AudioParam for ${p}`)
    let count = params.count
    let time = params._time
    let currentValue = getValue(param, def, requiredUnits)
    let nextValue = currentValue
    let segmentPower = param._segmentPower
    let nextSegment = params.count + param._nextSegment
    audioParam.setValueAtTime(applyMod(currentValue, mod), 0)
    while (!!nextSegment && nextSegment !== count && count <= params.count + params.dur) { // !!!!!!!!!!SHOULDNT BE DUR!!!!!!!
      param = getParamValue(evalParamPerFrame(params, p, nextSegment, undefined), subP)
      nextValue = getValue(param, def, requiredUnits)
      let nextTime = time + (nextSegment - count) * params.beat.duration
      // Setup segment
      if (segmentPower === 0) {
        audioParam.setValueAtTime(applyMod(nextValue, mod), time)
      } else if (segmentPower === 2) {
        let imCount = (count + nextSegment) / 2
        let imValue = getValue(getParamValue(evalParamPerFrame(params, p, imCount, undefined), subP), def, requiredUnits)
        let imTime = (time + nextTime) / 2
        // Vt = V1 + (V0 - V1) * e ^ -((t-T0) / tc)    From Web Audio API spec for setTargetAtTime
        // tc = -(t - T0) / ln((Vt - V1) / (V0 - V1))   Rearrranged
        let tc = -(imTime - time) / Math.log((imValue - nextValue) / (currentValue - nextValue))
        audioParam.setTargetAtTime(applyMod(nextValue, mod), time, tc)
      } else {
        audioParam.setValueAtTime(applyMod(currentValue, mod), time) // Set value at start so linear ramp is from correct start
        audioParam.linearRampToValueAtTime(applyMod(nextValue, mod), nextTime) // Use linear for everything else
      }
      // Move on to next segment
      currentValue = nextValue
      time = nextTime
      count = nextSegment
      nextSegment = params.count + param._nextSegment
      segmentPower = param._segmentPower
    }
    return true
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let {eventTimeVar} = require('expression/eval-timevars')

    let mockAp = () => {
      let calls = []
      return {
        calls: calls,
        cancelScheduledValues: (...args) => calls.push(['cancelScheduledValues'].concat(args)),
        setValueAtTime: (...args) => calls.push(['setValueAtTime'].concat(args)),
        linearRampToValueAtTime: (...args) => calls.push(['linearRampToValueAtTime'].concat(args)),
        exponentialRampToValueAtTime: (...args) => calls.push(['exponentialRampToValueAtTime'].concat(args)),
        setTargetAtTime: (...args) => calls.push(['setTargetAtTime'].concat(args)),
        setValueCurveAtTime: (...args) => calls.push(['setValueCurveAtTime'].concat(args)),
      }
    }
    let pm = (exp) => { return { foo:{value:exp,q:10}, count:1, dur:4, _time:2, beat:{duration:2} } }
    let ps = (exp) => { return { foo:{value:10,sub:exp}, count:1, dur:4, _time:2, beat:{duration:2} } }
    let doubleIt = x => x*2
    let u2 = [undefined,undefined]
    let hz = (v) => { return {value:v,_units:'hz'} }
    let ap
    let step = (i) => 0
    step.segmentPower = 0
    let lin = (i) => i
    lin.segmentPower = 1
    let exp = (i) => 1-Math.exp(-8*i)
    exp.segmentPower = 2
    let smooth = (i) => i*i*(3-2*i)
    smooth.segmentPower = 3
  
    assert(false, segmentedAudioParam(mockAp(), pm(1), 'foo', undefined, 99, 'hz', doubleIt))
    assert(false, segmentedAudioParam(mockAp(), ps(1), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(false, segmentedAudioParam(mockAp(), ps({value:1}), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(false, segmentedAudioParam(mockAp(), ps({value:1,_units:'hz'}), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(false, segmentedAudioParam(mockAp(), ps(() => {return {value:1}}), 'foo', 'sub', 99, 'hz', doubleIt))

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, pm( eventTimeVar([hz(8),hz(9)], u2, u2, 1) ), 'foo', undefined, 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([hz(8),hz(9)], u2, u2, 1) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([hz(8),hz(4)], [exp,step], u2, 1) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(3, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setTargetAtTime', 8,2,0.25], ap.calls[1])
    assert(['setValueAtTime', 8,4], ap.calls[2])

    console.log('Segmented audioParam tests complete')
  }

  return {
    segmentedAudioParam: segmentedAudioParam,
  }
})
