'use strict';
define(function (require) {
  let {mainParamUnits} = require('player/sub-param')
  let {evalParamFrame} = require('player/eval-param')
  let metronome = require('metronome')
  let system = require('play/system')

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
// console.log(`Segment: ${type} ${moddedV} ${args} ${metronome.timeNow()}`)
      audioParam[type](moddedV, ...args)
    } catch (e) {
      console.log(`!!! Bad audioParam segment ${type} ${moddedV} ${args}`)
      console.trace(e)
    }
  }

  let buildSegment = ({time, nextTime, count, nextSegment, segmentPower, currentValue, getValueAtTime, audioParam, mod}) => {
    // console.log(`segmentPower ${segmentPower}`)
    if (segmentPower === 0) { // Power 0 is fixed value over the segment
      addSegment(audioParam, 'setValueAtTime', currentValue, mod, time)
    } else {
      let epsilon = 1e-5 // Apply an epsilon to detect and handle zero length segments
      let endValue = getValueAtTime(nextSegment - epsilon) // Calculate value inside end of segment to avoid problems with zero length segments
      if (segmentPower === 2 && currentValue !== endValue) { // Power 2 for exponential curve
        let imCount = (count + nextSegment) / 2
        let imValue = getValueAtTime(imCount) // Get a halfway value
        let imTime = (time + nextTime) / 2
        // Vt = V1 + (V0 - V1) * e ^ -((t-T0) / tc)    From Web Audio API spec for setTargetAtTime
        // tc = -(t - T0) / ln((Vt - V1) / (V0 - V1))   Rearrranged
        let tc = -(imTime - time) / Math.log((imValue - endValue) / (currentValue - endValue))
        if (isNaN(tc)) { // If tc is NaN then fall back to exp; can happen when a segment is multiplied by another value with a discontinuity, eg riser when it rolls over back to zero...
          addSegment(audioParam, 'setValueAtTime', currentValue, mod, time) // Set value at start so linear ramp is from correct start
          addSegment(audioParam, 'exponentialRampToValueAtTime', endValue, mod, nextTime)
        } else {
          addSegment(audioParam, 'setTargetAtTime', endValue, mod, time, tc)
        }
      } else if (segmentPower >= 3) { // Power 3 to fit a series of linear steps to approximate the function
        addSegment(audioParam, 'setValueAtTime', currentValue, mod, time) // Set value at start so linear ramp is from correct start
        let numSteps = 16
        for (let i=1; i<numSteps; i++) {
          let imCount = count + (nextSegment-count) * i/numSteps
          let imValue = getValueAtTime(imCount) // Get a halfway value
          let imTime = time + (nextTime-time) * i/numSteps
          addSegment(audioParam, 'linearRampToValueAtTime', imValue, mod, imTime)
        }
        addSegment(audioParam, 'linearRampToValueAtTime', endValue, mod, nextTime)
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
      segmentState.nextTime = segmentState.countToTime(segmentState.nextSegment)
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
    segmentState.getParamAtTime = (count) => getParamValue(evalParamPerFrame(evalAt, count, undefined), subP)
    segmentState.getValueFromParam = (param) => getValue(param, def, requiredUnits)
    segmentState.getValueAtTime = (count) => segmentState.getValueFromParam(segmentState.getParamAtTime(count))
    segmentState.audioParam = audioParam
    segmentState.mod = mod
    let startCount = params.count
    let startTime = params._time
    if (startTime === undefined) { // No event time (eg. persistent fx/bus chain) — anchor to now, and keep startCount consistent so we don't backfill segments from the past
      startTime = system.timeNow()
      startCount = metronome.beatTime(startTime)
    }
    // Sub-beat timing offset (eg. an event's delay/swing) expressed in beats, frozen at construction.
    // Folding it into the count rather than adding seconds preserves the offset while letting it scale
    // with tempo. ~0 for on-grid events and chains.
    let constructionBeat = params.beat || { count: startCount, time: startTime, duration: metronome.beatDuration() }
    let offsetBeats = (startTime - (constructionBeat.time + (startCount - constructionBeat.count) * constructionBeat.duration)) / constructionBeat.duration
    segmentState.param = segmentState.getParamAtTime(startCount + epsilon)
    segmentState.count = startCount
    segmentState.time = startTime
    segmentState.currentValue = segmentState.getValueFromParam(segmentState.param)
    segmentState.nextValue = segmentState.currentValue
    segmentState.segmentPower = segmentState.param._segmentPower
    segmentState.nextSegment = segmentState.param._nextSegment
    addSegment(audioParam, 'setValueAtTime', segmentState.currentValue, mod, 0) // Initial value
    let dur
    let endTime = params.chainEndTime ? params.chainEndTime : params.endTime
    if (endTime) { // Duration from envelope-set endTime
      dur = (endTime - params._time) / metronome.beatDuration()
    } else { // Duration from intended event duration
      dur = params.dur || 1
    }
    let endCount = startCount + dur
    return (upToAudioTime) => { // Build segments incrementally up to given audio time (undefined = build all)
      // Pivot the count<->time mapping on the live beat (params.beat is a live getter for persistent
      // fx/bus chains, a frozen object for scheduled events), re-read each call, instead of a frozen
      // construction anchor. This keeps both tempo AND phase locked to the metronome across bpm changes
      // mid-chain. Under constant tempo it is identical to a frozen anchor. The fallback reproduces the
      // old frozen behaviour when no beat is available. Note: because segments are built a little ahead,
      // a large instantaneous tempo jump can shift the next segment's time slightly relative to already
      // committed automation; the adjustment is bounded by the build-ahead window and Web Audio clamps
      // any sub-now time.
      let beat = params.beat || { count: startCount, time: startTime, duration: metronome.beatDuration() }
      segmentState.countToTime = (c) => beat.time + (c + offsetBeats - beat.count) * beat.duration
      segmentState.time = segmentState.countToTime(segmentState.count) // Re-sync cursor to the live beat
      let upToCount = (upToAudioTime !== undefined)
        ? beat.count + (upToAudioTime - beat.time) / beat.duration - offsetBeats
        : endCount
      segmentStepper(segmentState, Math.min(upToCount, endCount))
      return !!segmentState.nextSegment && segmentState.count <= endCount
    }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

    let assert = (expected, actual) => {
      let x = JSON.stringify(expected, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      let a = JSON.stringify(actual, (k,v) => (typeof v == 'number') ? (v+0.0001).toFixed(2) : v)
      if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
    }
    let {eventTimeVar, timeVar} = require('expression/eval-timevars')

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
    let pow = (i) => Math.pow(i,2)
    pow.segmentPower = 3
  
    assert(false, isSegmented(1))
    assert(false, isSegmented(1))
    assert(false, isSegmented({value:1}))
    assert(false, isSegmented({value:1,_units:'hz'}))
    assert(false, isSegmented(() => {return {value:1}}))
    assert(false, isSegmented( eventTimeVar([hz(8),hz(9)], u2, u2, 1, false) ))
    assert(true, isSegmented(eventTimeVar([hz(8),hz(9)], u2, u2, 1, true)(params,0)))

    let buildAll = (ap, ev) => {
      let advance = segmentedAudioParam(ap, ev, params, 'sub', 99, 'hz', doubleIt)
      assert(false, advance()) // undefined = build all
    }
    let buildAllMain = (ap, ev) => {
      let advance = segmentedAudioParam(ap, ev, params, undefined, 99, 'hz', doubleIt)
      assert(false, advance())
    }

    ap = mockAp()
    buildAllMain(ap, evalAtMain( eventTimeVar([hz(8)], u2, u2, 1, true) ))
    assert(1, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])

    ap = mockAp()
    buildAllMain(ap, evalAtMain( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
    assert(['setValueAtTime', 18,4], ap.calls[3])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([hz(8),hz(9)], u2, u2, 4, true) ))
    assert(4, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setValueAtTime', 16,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 18,10], ap.calls[2])
    assert(['setValueAtTime', 18,10], ap.calls[3])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([hz(8),hz(4)], [exp,step], u2, 1, true) ))
    assert(3, ap.calls.length)
    assert(['setValueAtTime', 16,0], ap.calls[0])
    assert(['setTargetAtTime', 8,2,0.25], ap.calls[1])
    assert(['setValueAtTime', 8,4], ap.calls[2])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([0,hz(8),4], [lin,exp,step], [1,2,3], undefined, true) ))
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 0,0], ap.calls[0])
    assert(['setValueAtTime', 0,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 16,4], ap.calls[2])
    assert(['setTargetAtTime', 8,4,0.5], ap.calls[3])
    assert(['setValueAtTime', 8,8], ap.calls[4])

    ap = mockAp()
    buildAll(ap, evalAtSub( eventTimeVar([1,0,1,0], [lin,lin,lin,step], [1/2,0,1/2,0], undefined, true) ))
    assert(5, ap.calls.length)
    assert(['setValueAtTime', 2,0], ap.calls[0])
    assert(['setValueAtTime', 2,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 0,3], ap.calls[2])
    assert(['setValueAtTime', 2,3], ap.calls[3])
    assert(['linearRampToValueAtTime', 0,4], ap.calls[4])

    ap = mockAp()
    buildAllMain(ap, evalAtMain( eventTimeVar([1,50], [lin,undefined], u2, undefined, true) ))
    assert(3, ap.calls.length)
    assert(['setValueAtTime', 2,0], ap.calls[0])
    assert(['setValueAtTime', 2,2], ap.calls[1])
    assert(['linearRampToValueAtTime', 100,10], ap.calls[2])

    ap = mockAp()
    buildAllMain(ap, evalAtMain( eventTimeVar([1,50], [pow,undefined], u2, undefined, true) ))
    assert(18, ap.calls.length)
    assert(['setValueAtTime', 2, 0], ap.calls[0])
    assert(['setValueAtTime', 2, 2], ap.calls[1])
    assert(['linearRampToValueAtTime', 2.38, 2.50], ap.calls[2])
    //...
    assert(['linearRampToValueAtTime', 100, 10], ap.calls[17])

    // Incremental build: advance only builds segments whose start count is within the given audio time
    ap = mockAp()
    {
      let advance = segmentedAudioParam(ap, evalAtMain( eventTimeVar([hz(8),hz(9)], u2, u2, 1, true) ), params, undefined, 99, 'hz', doubleIt)
      assert(1, ap.calls.length) // Only initial setValueAtTime so far
      assert(['setValueAtTime', 16,0], ap.calls[0])
      assert(true, advance(1.9)) // Before event start; no segments yet
      assert(1, ap.calls.length)
      assert(true, advance(3)) // Triggers first segment (count 1→2)
      assert(3, ap.calls.length)
      assert(['setValueAtTime', 16,2], ap.calls[1])
      assert(['linearRampToValueAtTime', 18,4], ap.calls[2])
      assert(false, advance(100)) // Finishes remaining
      assert(4, ap.calls.length)
      assert(['setValueAtTime', 18,4], ap.calls[3])
    }

    // Repeating, non-terminal step time-var (eg `[0:1/4,1:3/4]t@s`): each segment must
    // hold its own value, not be shifted one segment early. Param'd by beat, so segments
    // repeat every beat: value 0 over the first 1/4 beat, value 1 over the remaining 3/4.
    ap = mockAp()
    buildAllMain(ap, evalAtMain( timeVar([0,1], [step,step], [1/4,3/4], undefined, step, {addSegmentData:true}) ))
    assert(10, ap.calls.length)
    assert(['setValueAtTime', 0,0], ap.calls[0]) // Initial value (count 1 = start of a 0 segment)
    assert(['setValueAtTime', 0,2], ap.calls[1]) // count 1 (time 2): low for first quarter-beat
    assert(['setValueAtTime', 2,2.5], ap.calls[2]) // count 1.25 (time 2.5): high (1 doubled) for rest of beat
    assert(['setValueAtTime', 0,4], ap.calls[3]) // count 2 (time 4): low again
    assert(['setValueAtTime', 2,4.5], ap.calls[4]) // count 2.25 (time 4.5): high
    assert(['setValueAtTime', 0,6], ap.calls[5])
    assert(['setValueAtTime', 2,6.5], ap.calls[6])
    assert(['setValueAtTime', 0,8], ap.calls[7])
    assert(['setValueAtTime', 2,8.5], ap.calls[8])
    assert(['setValueAtTime', 0,10], ap.calls[9])

    // Repeating linear timevar with a zero-size mid-cycle segment (eg a phase-shifted grain
    // delay ramp `[d0:\s1, b:\0, a:\s2]t@s`): the zero-size segment must produce a clean
    // discontinuity (jump) each cycle, with correct linear ramps either side. Values ramp
    // 0 -> 0.75 over 3/4 beat, jump to 0, ramp 0 -> 0 (flat wrap) over the last 1/4 beat.
    ap = mockAp()
    buildAllMain(ap, evalAtMain( timeVar([0, 0.75, 0], [lin,lin,lin], [3/4, 0, 1/4], undefined, lin, {addSegmentData:true}) ))
    assert(19, ap.calls.length)
    assert(['setValueAtTime', 0,0], ap.calls[0]) // Initial value (count 1 = start of a ramp cycle)
    assert(['setValueAtTime', 0,2], ap.calls[1]) // count 1 (time 2): ramp cycle start
    assert(['linearRampToValueAtTime', 1.5,3.5], ap.calls[2]) // count 1.75: ramp peak (0.75 doubled)
    assert(['setValueAtTime', 0,3.5], ap.calls[3]) // zero-size segment: instantaneous jump down
    assert(['linearRampToValueAtTime', 0,4], ap.calls[4]) // flat wrap segment to count 2
    assert(['setValueAtTime', 0,4], ap.calls[5]) // next cycle, same shape
    assert(['linearRampToValueAtTime', 1.5,5.5], ap.calls[6])
    assert(['setValueAtTime', 0,5.5], ap.calls[7])
    assert(['linearRampToValueAtTime', 0,6], ap.calls[8])
    assert(['setValueAtTime', 0,10], ap.calls[17]) // still going strong at the end of the event
    assert(['linearRampToValueAtTime', 1.5,11.5], ap.calls[18])

    // bpm (tempo) change mid-chain. A long-lived fx/bus chain pivots its count<->time mapping on the
    // live beat (params.beat — a live getter for persistent chains), so a tempo change keeps it locked
    // to the beat grid in both rate AND phase, instead of stalling or drifting from a frozen anchor.
    {
      // Live beat anchor, as player-fx surfaces via metronome.lastBeat(); mutated below to emulate the
      // metronome re-anchoring to the new tempo at the most recent beat.
      let beat = { count:0, time:0, duration:1 } // 1 beat = 1 second
      let chainParams = { count:0, _time:0, endTime:1e6, get beat() { return beat } } // persistent-style
      // Repeating step var: value 0 for the first 1/4 of each beat, value 1 (doubled -> 2) for the rest.
      let evalAt = evalAtMain( timeVar([0,1], [step,step], [1/4,3/4], undefined, step, {addSegmentData:true}) )
      metronome.beatDuration(1)
      ap = mockAp()
      let advance = segmentedAudioParam(ap, evalAt, chainParams, undefined, 99, 'hz', doubleIt)
      advance(2.5) // build the first couple of beats at the original tempo
      let callsBeforeChange = ap.calls.length
      assert(true, callsBeforeChange > 1) // sanity: scheduling happened before the change

      // Tempo drops to a quarter: the metronome's last beat (count 2 at time 2) now lasts 4 seconds.
      beat = { count:2, time:2, duration:4 }
      metronome.beatDuration(4)
      for (let t = 3; t <= 8; t += 0.5) { advance(t) } // keep the chain running past the change

      assert(true, ap.calls.length > callsBeforeChange) // kept scheduling: did not stall
      // Phase preserved on the new grid: integer beat 3 (value 0) lands at time 6, and its following
      // 1/4-beat point (count 3.25, value 1 -> doubled 2) at time 7 (a quarter of the new 4s beat).
      let onGrid = (v, t) => ap.calls.some(c => c[0]==='setValueAtTime' && c[1]===v && Math.abs(c[2]-t)<1e-6)
      assert(true, onGrid(0, 6)) // beat 3 low, on the new beat grid
      assert(true, onGrid(2, 7)) // its 1/4-beat high, spaced at the new tempo
    }

    metronome.beatDuration(oldBeatDuration)
    console.log('Segmented audioParam tests complete')
  }

  return {
    isSegmented: isSegmented,
    segmentedAudioParam: segmentedAudioParam,
  }
})
