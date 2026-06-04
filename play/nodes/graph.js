'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let {connect,isConnectable} = require('play/nodes/connect')
  let connectOp = require('expression/connectOp')
  require('play/nodes/mocks')
  require('play/nodes/convolver')
  require('play/nodes/source')
  let vars = require('vars')

  let audioNodeProto
  let idnode = (args,e,b) => { // identity node; passes webaudio connections through without creating an actual node
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let node = Object.create(audioNodeProto)
    node.ls = []
    node.rs = []
    node.passthrough = (l) => {
      node.ls.push(l)
      node.rs.forEach(r => l.connect(r))
    }
    node.connect = (r) => {
      node.rs.push(r)
      node.ls.forEach(l => l.connect(r))
    }
    node.disconnect = () => {
      delete node.ls
      delete node.rs
    }
    Object.defineProperty(node, "numberOfInputs", { get() {
      return node.ls.reduce(Math.max, 1)
    } })
    Object.defineProperty(node, "numberOfOutputs", { get() {
      return node.rs.reduce(Math.max, 1)
    } })
    return node
  }
  addNodeFunction('idnode', idnode)
  addNodeFunction('thru', idnode)
  addNodeFunction('dry', idnode)

  let loop = (args,e,b,_,er) => {
    let mainChain = evalParamEvent(args['value'], e)
    if (!isConnectable(mainChain)) { mainChain = vars.all().gain({value:args['value']}, e,b) }
    let unevalledFeedback = args['feedback'] || args['value1']
    let feedbackChain = evalParamEvent(unevalledFeedback, e)
    if (!isConnectable(feedbackChain)) { feedbackChain = vars.all().gain({value:unevalledFeedback}, e,b) }
    if (mainChain === undefined) {
      mainChain = idnode(args,e,b)
      if (feedbackChain === undefined) { return mainChain }
    }
    let mixdownGain = system.audio.createGain()
    e._destructor.disconnect(mixdownGain)
    mainChain = connectOp(mainChain, mixdownGain, e,b,er) // Attach a placeholder gain node to force a mixdown of arrays and prevent idnode loops
    if (feedbackChain === undefined) {
      connect(mainChain, mainChain, e._destructor)
    } else {
      if (!isConnectable(feedbackChain)) { feedbackChain = gain({value:unevalledFeedback}, e,b) }
      connect(mainChain, feedbackChain, e._destructor)
      connect(feedbackChain, mainChain, e._destructor)
    }
    return mainChain
  }
  addNodeFunction('loop', loop)

  let series = (args,e,b,_,er) => {
    let count = evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2))
    if (typeof count !== 'number') { throw `series: count ${count} must numeric` }
    if (count < 0) { throw `series: count ${count} must be non-negative` }
    if (count === 0) { return idnode(args,e,b) }
    let node
    for (let i = 0; i<count; i++) {
      let chain = evalParamFrame(args['value'], e,b, {doNotMemoise:true}) // Must get new nodes for every repeat
      if (node === undefined) { node = chain }
      else { node = connectOp(node, chain, e,b,er) }
    }
    return node
  }
  addNodeFunction('series', series)

  // Perceptually even (log-spaced) crossover/centre frequencies across the audio
  // spectrum. Band i passes [lo,hi]; centre is the geometric mean used for the
  // callback. The lowest band's lo (20Hz) and the top band's hi (20kHz) sit at
  // the edges of hearing so those filters are effectively transparent.
  let bandFrequencies = (count, fmin, fmax) => {
    let ratio = fmax / fmin
    let bands = []
    for (let i = 0; i < count; i++) {
      bands.push({
        lo: fmin * Math.pow(ratio, i/count),
        hi: fmin * Math.pow(ratio, (i+1)/count),
        centre: fmin * Math.pow(ratio, (i+0.5)/count),
      })
    }
    return bands
  }

  let butterworth = (type, freq, e) => { // Non-resonant (maximally flat) filter for splitting bands
    let node = system.audio.createBiquadFilter()
    node.type = type
    node.frequency.value = freq
    node.Q.value = Math.SQRT1_2 // Butterworth Q: no resonant peak at the corner
    if (e && e._destructor) { e._destructor.disconnect(node) }
    return node
  }

  // One band of a complementary (difference-of-lowpasses) crossover. Each band is fed
  // the same input x and built so the band transfer functions telescope to 1:
  //   band 0   = +LP(hi)               first band, no lower crossover
  //   band k   = +LP(hi) -LP(lo)       middle band
  //   top band = +x      -LP(lo)       last band, passes x straight on the + path
  // The LP(hi) in band k and the LP(lo) in band k+1 share the same crossover frequency,
  // so (fed identical x) they produce identical signals that cancel when the bands are
  // summed - the bands reconstruct x exactly, with no crossover dips and no level loss,
  // regardless of filter Q/order. Returns a {l,r} composite (input idnode, summing gain).
  let complementaryBand = (band, isFirst, isLast, e,b) => {
    let input = idnode({}, e, b) // fan-in point for x; also sets audioNodeProto lazily
    let sum = system.audio.createGain()
    sum.gain.value = 1
    if (e && e._destructor) { e._destructor.disconnect(sum) }
    if (isLast) {
      connect(input, sum) // top band: pass the signal straight through (+x)
    } else {
      connect(connect(input, butterworth('lowpass', band.hi, e)), sum) // +LP(upper crossover)
    }
    if (!isFirst) { // subtract everything below this band: -LP(lower crossover)
      let inv = system.audio.createGain()
      inv.gain.value = -1
      if (e && e._destructor) { e._destructor.disconnect(inv) }
      connect(connect(input, butterworth('lowpass', band.lo, e)), inv)
      connect(inv, sum)
    }
    let composite = Object.create(Object.getPrototypeOf(input)) // satisfies instanceof AudioNode
    composite.l = input
    composite.r = sum
    composite.connect = (dest) => connect(sum, dest)
    composite.disconnect = () => {}
    if (e && e._destructor) { e._destructor.disconnect(composite) }
    return composite
  }

  // multiband{{i,centre}->chain, count} : split the input into `count` perceptually
  // even frequency bands (default 3) using a complementary crossover (see complementaryBand),
  // run each band through the chain the callback builds for it (given the band index and its
  // centre frequency), then sum all bands back together. The bands reconstruct the input
  // exactly when unprocessed, so multiband{1} - and any uniform processing - is transparent.
  // Returning a {value,value1,...} map makes connect() fan the input out to every band's
  // input and sum every band's output.
  let multiband = (args,e,b,_,er) => {
    let count = Math.floor(evalMainParamEvent(args, 'value1', evalMainParamEvent(args, 'count', 3)))
    if (typeof count !== 'number' || isNaN(count)) { throw `multiband: count must be numeric` }
    if (count < 1) { return idnode(args,e,b) }
    let callback = args['value'] || args['chain']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let result = {}
    bandFrequencies(count, 20, 20000).forEach((band, i) => {
      let split = complementaryBand(band, i===0, i===count-1, e,b)
      let proc
      if (isLambda) {
        let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e)) // Distinct event so per-function memoisation doesn't collapse every band to band 0; clone descriptors so non-enumerable getters (count, _time, ...) from the fx-chain event survive
        proc = callback(ev, b, evalParamFrame, {value:i, value1:band.centre})
        if (!isConnectable(proc)) {
          // The body evaluated to an amplitude, not a node chain (eg `{i}->[]n{seed:i}`).
          // Calling it once above freezes that value, so instead hand the lambda itself to
          // gain as its value param and let gain's evalMainParamFrame (withInterval) decide
          // from the body's runtime interval: a frame-varying body gets per-frame updates,
          // a static body stays a constant gain with no per-frame callback - exactly like
          // gain{<body>}. Reuse the per-band `ev` so the inner lambda stays memoisation-isolated.
          let bandGain = (e2,b2,er2) => callback(ev, b2, er2, {value:i, value1:band.centre})
          proc = vars.all().gain({value:bandGain}, e,b)
        }
      } else if (callback !== undefined) {
        proc = evalParamFrame(callback, e,b, {doNotMemoise:true})
      }
      if (!isConnectable(proc)) {
        proc = (proc === undefined) ? idnode(args,e,b) : vars.all().gain({value:proc}, e,b)
      }
      result[i===0 ? 'value' : 'value'+i] = connectOp(split, proc, e,b,er)
    })
    return result
  }
  addNodeFunction('multiband', multiband)

  let mix = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let wetChain = evalParamEvent(params.value, e)
    if (wetChain === undefined) { return idnode(params,e,b) }
    if (!isConnectable(wetChain)) { wetChain = vars.all().gain({value:params.value}, e,b) }
    let mixParam = params.mix !== undefined ? 'mix' : 'value1'
    let mixValue = evalParamFrame(params[mixParam], e,e.count, {withInterval:true})
    let interval
    if (typeof mixValue === 'object' && mixValue.interval !== undefined && !isConnectable(mixValue)) {
      interval = mixValue.interval
      mixValue = mixValue.value
    }
    if (interval === undefined && mixValue <= 0.0001) { // dry only
      return idnode(params,e,b)
    }
    if (interval === undefined && mixValue >= 0.9999) { // wet only
      return wetChain
    }
    // Actual mix, equivalent to:  { gain{cos{mix*pi/2}}, wet>>gain{sin{mix*pi/2}} }
    let dryGain = system.audio.createGain()
    let wetGain = system.audio.createGain()
    evalMainParamFrame(dryGain.gain, params, mixParam, 1/2, undefined, mix => Math.cos(mix * Math.PI/2))
    evalMainParamFrame(wetGain.gain, params, mixParam, 1/2, undefined, mix => Math.sin(mix * Math.PI/2))
    return { // Add
      value: dryGain, // Dry part
      value1: connectOp(wetChain, wetGain, e,b,er) // Wet part
    }
  }
  addNodeFunction('mix', mix)

  let stereo = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let lChainParam = 'l'
    let lChain = evalParamEvent(params.l, e)
    if (lChain === undefined) { lChain = evalParamEvent(params.value, e); lChainParam = 'value' }
    if (!isConnectable(lChain)) {
      lChain = system.audio.createGain()
      if (lChain !== undefined) { evalMainParamFrame(lChain.gain, params, lChainParam, 1) }
    }
    let rChainParam = 'r'
    let rChain = evalParamEvent(params.r, e)
    if (rChain === undefined) { rChain = evalParamEvent(params.value1, e); rChainParam = 'value1' }
    if (rChain === undefined) { rChain = evalParamEvent(params.value, e); rChainParam = 'value' }
    if (!isConnectable(rChain)) {
      rChain = system.audio.createGain()
      if (rChain !== undefined) { evalMainParamFrame(rChain.gain, params, rChainParam, 1) }
    }
    // splitter >> l/r chains >> merger
    let splitter = system.audio.createChannelSplitter(2)
    let merger = system.audio.createChannelMerger(2)
    connect(connect(splitter, lChain, e._destructor, {channel:0}), merger, e._destructor, {channel:0})
    connect(connect(splitter, rChain, e._destructor, {channel:1}), merger, e._destructor, {channel:1})
    // Make and return a composite with splitter as l and merger as r
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let composite = Object.create(audioNodeProto)
    composite.l = splitter
    composite.r = merger
    composite.destructor = e._destructor
    composite.connect = (destination) => {
      return connect(composite.r, destination, e._destructor)
    }
    return composite
  }
  addNodeFunction('stereo', stereo)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let close = (a,b) => Math.abs(a-b) < 1e-6

  // bandFrequencies: perceptually even (log) spacing across the audio spectrum
  let bands = bandFrequencies(4, 20, 20000)
  assert(4, bands.length)
  assert(true, close(bands[0].lo, 20))        // lowest band starts at fmin
  assert(true, close(bands[3].hi, 20000))     // top band ends at fmax
  bands.forEach((band,i) => {                 // adjacent bands share crossover points
    if (i>0) { assert(true, close(band.lo, bands[i-1].hi)) }
    assert(true, close(band.centre, Math.sqrt(band.lo*band.hi))) // centre is geometric mean
  })
  let ratio = bands[1].centre/bands[0].centre // log spacing -> constant ratio between centres
  assert(true, close(bands[2].centre/bands[1].centre, ratio))
  assert(true, close(bands[3].centre/bands[2].centre, ratio))

  // complementaryBand: builds a {l,r} composite for one band of the crossover
  let cbE = {_destructor:require('play/destructor')()}
  let cbBands = bandFrequencies(3, 20, 20000)
  let cbMid = complementaryBand(cbBands[1], false, false, cbE, 0)
  assert(true, isConnectable(cbMid))
  assert(true, cbMid.l !== undefined && cbMid.r !== undefined)
  assert(true, isConnectable(complementaryBand(cbBands[0], true, false, cbE, 0)))  // first band
  assert(true, isConnectable(complementaryBand(cbBands[2], false, true, cbE, 0)))  // top band

  // multiband: callback is invoked once per band with index + centre frequency,
  // and the result is a {value,value1,...} map that connect() treats as parallel.
  let dest = require('play/destructor')()
  let ev = {_destructor:dest}
  let er = (v) => v // passthrough evalRecurse: operands here are already real nodes
  let calls = []
  let cb = (e,b,erFn,a) => { calls.push(a); return system.audio.createGain() }
  cb.isUserFunction = true
  let res = multiband({value:cb, value1:3}, ev, 0, undefined, er)
  assert(3, calls.length)
  assert([0,1,2], calls.map(a => a.value)) // band indices passed in order
  let bf = bandFrequencies(3, 20, 20000)
  assert(true, close(calls[0].value1, bf[0].centre)) // centre frequency passed alongside index
  assert(true, close(calls[2].value1, bf[2].centre))
  assert(true, isConnectable(res))
  assert(true, res.value !== undefined && res.value1 !== undefined && res.value2 !== undefined && res.value3 === undefined)

  // No callback -> bands are split and recombined through identity nodes
  let res2 = multiband({value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(res2))
  assert(true, res2.value !== undefined && res2.value1 !== undefined && res2.value2 === undefined)

  // Band count defaults to 3 when unspecified
  let res3 = multiband({}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, res3.value !== undefined && res3.value2 !== undefined && res3.value3 === undefined)

  console.log('Graph (multiband) tests complete')
  }
})
