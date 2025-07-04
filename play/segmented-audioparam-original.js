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

  let addSegment = (audioParam, type, v, mod, ...args) => {
    let moddedV = mod === undefined ? v : mod(v)
    try {
      audioParam[type](moddedV, ...args)
// console.log(`Segment: ${type} ${moddedV} ${args}`)
    } catch (e) {
      console.log(`!!! Bad audioParam segment ${type} ${moddedV} ${args}`)
    }
  }

  let buildSegment = (audioParam, params, p, subP, def, requiredUnits, mod, {time, nextTime, count, nextSegment, segmentPower, currentValue, nextValue}) => {
    if (segmentPower === 0) {
      addSegment(audioParam, 'setValueAtTime', nextValue, mod, time)
    } else {
      let epsilon = 1e-5 // Apply an epsilon to detect and handle zero length segments
      let endParam = getParamValue(evalParamPerFrame(params, p, nextSegment - epsilon, undefined), subP)
      let endValue = getValue(endParam, def, requiredUnits) // Calculate value inside end of segment to avoid problems with zero length segments
      if (segmentPower === 2 && currentValue !== endValue) {
        let imCount = (count + nextSegment) / 2
        let imValue = getValue(getParamValue(evalParamPerFrame(params, p, imCount, undefined), subP), def, requiredUnits)
        let imTime = (time + nextTime) / 2
        // Vt = V1 + (V0 - V1) * e ^ -((t-T0) / tc)    From Web Audio API spec for setTargetAtTime
        // tc = -(t - T0) / ln((Vt - V1) / (V0 - V1))   Rearrranged
        let tc = -(imTime - time) / Math.log((imValue - endValue) / (currentValue - endValue))
        addSegment(audioParam, 'setTargetAtTime', endValue, mod, time, tc)
      } else { // Use linear for everything else
        addSegment(audioParam, 'setValueAtTime', currentValue, mod, time) // Set value at start so linear ramp is from correct start
        addSegment(audioParam, 'linearRampToValueAtTime', endValue, mod, nextTime)
      }
    }
  }

  let segmentedAudioParam = (audioParam, params, p, subP, def, requiredUnits, mod) => { // !! ASSUME mod IS LINEAR
    let epsilon = 1e-5 // Apply an epsilon for the initial value
    if (params.beat === undefined) { return } // Bus does not have normal event data; not worth trying to segment
    let segmentState = {}
    segmentState.param = getParamValue(evalParamPerFrame(params, p, params.count + epsilon, undefined), subP)
    if (segmentState.param._nextSegment === undefined) { return false } // No segment data; we cant build a segment timeline here
    segmentState.count = params.count
    segmentState.time = params._time
    segmentState.currentValue = getValue(segmentState.param, def, requiredUnits)
    segmentState.nextValue = segmentState.currentValue
    segmentState.segmentPower = segmentState.param._segmentPower
    segmentState.nextSegment = segmentState.param._nextSegment
    addSegment(audioParam, 'setValueAtTime', segmentState.currentValue, mod, 0)
    if (params.endTime) { // Duration from envelope-set endTime
      let timeDur = params.endTime - params._time
      segmentState.dur = timeDur / params.beat.duration
    } else { // Duration from intended event duration
      segmentState.dur = params.dur || 1
    }
    while (!!segmentState.nextSegment && segmentState.nextSegment !== segmentState.count && segmentState.count <= params.count + segmentState.dur) {
      let epsilon = 1e-5 // Apply an epsilon to make sure we get the _next_ segment not the current one
      segmentState.param = getParamValue(evalParamPerFrame(params, p, segmentState.nextSegment + epsilon, undefined), subP)
      segmentState.nextValue = getValue(segmentState.param, def, requiredUnits)
      segmentState.nextTime = segmentState.time + (segmentState.nextSegment - segmentState.count) * params.beat.duration
// console.log(`count ${segmentState.count} nextSegment ${segmentState.nextSegment} / params.count ${params.count} dur ${segmentState.dur} / time ${time} nextTime ${nextTime} / param ${JSON.stringify(param)}`)
// console.log(`segment time delta ${(segmentState.nextTime - segmentState.time + 0.0001).toFixed(3)}`)
      buildSegment(audioParam, params, p, subP, def, requiredUnits, mod, segmentState)
      segmentState.currentValue = segmentState.nextValue
      segmentState.time = segmentState.nextTime
      segmentState.count = segmentState.nextSegment
      segmentState.nextSegment = segmentState.param._nextSegment
      segmentState.segmentPower = segmentState.param._segmentPower
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
    let pe = (exp) => { return { foo:{value:10,sub:exp}, count:1, dur:4, _time:2, endTime:10, beat:{duration:2} } }
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
    assert(true, segmentedAudioParam(ap, pm( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), 'foo', undefined, 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, pe( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, pe( eventTimeVar([hz(8),hz(9)], u2, u2, 4, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,10], ap.calls[2])
    assert(['setValueAtTime', 18,10], ap.calls[3])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([hz(8),hz(4)], [exp,step], u2, 1, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(3, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setTargetAtTime', 8,2,0.25], ap.calls[1])
    assert(['setValueAtTime', 8,4], ap.calls[2])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([0,hz(8),4], [lin,exp,step], [1,2,3], undefined, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 0,0], ap.calls[0])
    assert(['setValueAtTime', 0,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 16,4], ap.calls[2])
    assert(['setTargetAtTime', 8,4,0.5], ap.calls[3])
    assert(['setValueAtTime', 8,8], ap.calls[4])

    ap = mockAp()
    assert(true, segmentedAudioParam(ap, ps( eventTimeVar([1,0,1,0], [lin,lin,lin,step], [1/2,0,1/2,0], undefined, true) ), 'foo', 'sub', 99, 'hz', doubleIt))
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 2,0], ap.calls[0])
    assert(['setValueAtTime', 2,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 0,3], ap.calls[2])
    assert(['setValueAtTime', 2,3], ap.calls[3])
    assert(['linearRampToValueAtTime', 0,4], ap.calls[4])

    console.log('Segmented audioParam tests complete')
  }

  return {
    segmentedAudioParam: segmentedAudioParam,
  }
})
