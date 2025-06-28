'use strict';
define(function (require) {
  let {mainParamUnits} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')
  let metronome = require('metronome')

  let evalParamPerFrame = (evalAt, b, def) => {
    let v =  evalAt(b) // Room for optimisation here: only eval objects the specific sub (or main) param thats needed for this call
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
      console.trace(e)
    }
  }

  let buildSegment = ({time, nextTime, count, nextSegment, segmentPower, currentValue, nextValue, getValueAtTime, audioParam, mod}) => {
    if (segmentPower === 0) {
      addSegment(audioParam, 'setValueAtTime', nextValue, mod, time)
    } else {
      let epsilon = 1e-5 // Apply an epsilon to detect and handle zero length segments
      let endValue = getValueAtTime(nextSegment - epsilon) // Calculate value inside end of segment to avoid problems with zero length segments
      if (segmentPower === 2 && currentValue !== endValue) {
        let imCount = (count + nextSegment) / 2
        let imValue = getValueAtTime(imCount)
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

  let segmentStepper = (segmentState, endCount) => {
    while (!!segmentState.nextSegment && segmentState.nextSegment !== segmentState.count && segmentState.count <= endCount) {
      let epsilon = 1e-5 // Apply an epsilon to make sure we get the _next_ segment not the current one
      segmentState.param = segmentState.getParamAtTime(segmentState.nextSegment + epsilon)
      segmentState.nextValue = segmentState.getValueFromParam(segmentState.param)
      segmentState.nextTime = segmentState.time + (segmentState.nextSegment - segmentState.count) * metronome.beatDuration()
// console.log(`segment time delta ${(segmentState.nextTime - segmentState.time + 0.0001).toFixed(3)}`)
      buildSegment(segmentState)
      segmentState.currentValue = segmentState.nextValue
      segmentState.time = segmentState.nextTime
      segmentState.count = segmentState.nextSegment
      segmentState.nextSegment = segmentState.param._nextSegment
      segmentState.segmentPower = segmentState.param._segmentPower
    }
  }

  let isSegmented = (param) => {
    if (typeof param !== 'object') { return false }
    return param._nextSegment !== undefined
  }

  let epsilon = 1e-5 // Apply an epsilon for the initial value
  let segmentedAudioParam = (audioParam, evalAt, params, subP, def, requiredUnits, mod) => { // !! ASSUME mod IS LINEAR
    let segmentState = {}
    segmentState.getParamAtTime = (count) => {
      return getParamValue(evalParamPerFrame(evalAt, count, undefined), subP)
    }
    segmentState.getValueFromParam = (param) => {
      return getValue(param, def, requiredUnits)
    }
    segmentState.getValueAtTime = (count) => {
      return segmentState.getValueFromParam(segmentState.getParamAtTime(count))
    }
    segmentState.param = segmentState.getParamAtTime(params.count + epsilon)
    segmentState.count = params.count
    segmentState.time = params._time
    segmentState.currentValue = segmentState.getValueFromParam(segmentState.param)
    segmentState.nextValue = segmentState.currentValue
    segmentState.segmentPower = segmentState.param._segmentPower
    segmentState.nextSegment = segmentState.param._nextSegment
    segmentState.audioParam = audioParam
    segmentState.mod = mod
    addSegment(audioParam, 'setValueAtTime', segmentState.currentValue, mod, 0) // Initial value
    // Run to end of event
    let dur
    if (params.endTime) { // Duration from envelope-set endTime
      let timeDur = params.endTime - params._time
      dur = timeDur / metronome.beatDuration()
    } else { // Duration from intended event duration
      dur = params.dur || 1
    }
    segmentStepper(segmentState, params.count + dur)
    return false
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
    let oldBeatDuration = metronome.beatDuration()
    metronome.beatDuration(2)
    let params = { count:1, dur:4, _time:2, endTime:10 }
    let evalAtMain = (exp) => (count) => { return {value:evalParamFrame(exp, params, count),q:10} }
    let evalAtSub = (exp) => (count) => { return {value:10,sub:evalParamFrame(exp, params, count)} }
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
  
    assert(false, isSegmented(1))
    assert(false, isSegmented(1))
    assert(false, isSegmented({value:1}))
    assert(false, isSegmented({value:1,_units:'hz'}))
    assert(false, isSegmented(() => {return {value:1}}))
    assert(false, isSegmented( eventTimeVar([hz(8),hz(9)], u2, u2, 1, false) ))
    assert(true, isSegmented(eventTimeVar([hz(8),hz(9)], u2, u2, 1, true)(params,0)))

    ap = mockAp()
    segmentedAudioParam(ap, evalAtMain( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), params, undefined, 99, 'hz', doubleIt)
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 4, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,10], ap.calls[2])
    assert(['setValueAtTime', 18,10], ap.calls[3])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([hz(8),hz(4)], [exp,step], u2, 1, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(3, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setTargetAtTime', 8,2,0.25], ap.calls[1])
    assert(['setValueAtTime', 8,4], ap.calls[2])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([0,hz(8),4], [lin,exp,step], [1,2,3], undefined, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 0,0], ap.calls[0])
    assert(['setValueAtTime', 0,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 16,4], ap.calls[2])
    assert(['setTargetAtTime', 8,4,0.5], ap.calls[3])
    assert(['setValueAtTime', 8,8], ap.calls[4])

    ap = mockAp()
    segmentedAudioParam(ap, evalAtSub( eventTimeVar([1,0,1,0], [lin,lin,lin,step], [1/2,0,1/2,0], undefined, true) ), params, 'sub', 99, 'hz', doubleIt)
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 2,0], ap.calls[0])
    assert(['setValueAtTime', 2,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 0,3], ap.calls[2])
    assert(['setValueAtTime', 2,3], ap.calls[3])
    assert(['linearRampToValueAtTime', 0,4], ap.calls[4])

    metronome.beatDuration(oldBeatDuration)
    console.log('Segmented audioParam tests complete')
  }

  return {
    isSegmented: isSegmented,
    segmentedAudioParam: segmentedAudioParam,
  }
})
