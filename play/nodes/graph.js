'use strict'
define(function(require) {
  let {addNodeFunction,combineParams} = require('play/nodes/node-var')
  let system = require('play/system');
  let {evalMainParamEvent,evalMainParamFrame} = require('play/eval-audio-params')
  let {evalParamFrame,evalParamEvent} = require('player/eval-param')
  let {connect,isConnectable} = require('play/nodes/connect')
  let connectOp = require('expression/connectOp')
  let {mixShaderNode} = require('draw/visualsynth/shader-mix')
  let {isShaderNode,constShaderNode,passthroughShaderNode} = require('draw/visualsynth/shader-node')
  let {seriesShaderNode,parallelShaderNode,multitapShaderNode,loopIndexNode,loopShaderNode,zeroShaderNode} = require('draw/visualsynth/shader-repeat')
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

  // A px chain compiles to a real GLSL for loop instead of an audio feedback loop: the body is
  // emitted once and iterated, its output feeding back into its input. Dispatched on what the body
  // came back as, the same rule mix{} uses, so audio is untouched.
  //
  // The body's index has to be a value in the shader rather than a javascript number, so a user
  // defined function has to be called with a node — but calling it that way before we know this is
  // visual would change what an audio loop{} does with a lambda. So the probe in loop{} below stays
  // exactly as it was (evalParamEvent calls a lambda with no arguments at all), and only once that
  // says visual is the lambda called again with the index: directly, so memoisation cannot hand back
  // the probe's result, and on an event of its own, as series does. Nothing real is wasted — a
  // shader node is a pure description, and tex{}'s texture acquisition, the one event time side
  // effect in the system, is cached.
  //
  // sum: is a fold alongside the carried value: a chain of its own whose result is totalled over the
  // iterations, which is what the loop then hands on. It is resolved exactly as the body is, so one
  // rule covers both — a lambda is called, anything else is evaluated as a chain expression (so a
  // bare call head needs an explicit id>>, as it does for the body) and a result that is not a node
  // becomes an animated uniform, the same wrap visualChains uses. Its lambda takes the value first
  // and the index second, unlike the body's: the body *is* the chain, so its value flows implicitly,
  // where the sum is an expression of that value and wants to name it.
  let sumChain = (args, idx, e, b) => {
    let callback = args['sum']
    if (callback === undefined) { return undefined }
    if (typeof callback !== 'function' || !callback.isUserFunction) {
      let chain = evalParamEvent(callback, e)
      return isShaderNode(chain) ? chain : constShaderNode(callback)
    }
    let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e))
    // Its own callsite id, so a lambda used as both body and sum keeps two sets of uniforms in the
    // per frame memo key (getCallTreeString) rather than collapsing onto one - see repeatChain below
    let sumArgs = () => ({value:passthroughShaderNode(), value1:idx, __functionContext:'sum;'})
    let chain = callback(ev, b, evalParamFrame, sumArgs())
    return isShaderNode(chain) ? chain : constShaderNode((e2,b2,er2) => callback(ev, b2, er2, sumArgs()))
  }

  let visualLoop = (callback, isLambda, probe, args, e, b) => {
    let idx, body = probe
    let sumIsLambda = typeof args['sum'] === 'function' && args['sum'].isUserFunction
    if (isLambda || sumIsLambda) { idx = loopIndexNode() } // One index node, so body and sum share the one counter
    if (isLambda) {
      let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e)) // Its own event, so the probe's memoised values can't leak in; clone descriptors so non-enumerable getters from the fx-chain event survive
      body = callback(ev, b, evalParamFrame, {value:idx})
    }
    if (!isShaderNode(body)) { return undefined }
    let count = Math.floor(evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2)))
    if (typeof count !== 'number' || isNaN(count)) { throw `loop: count must be numeric` }
    let sum = sumChain(args, idx, e, b)
    if (count < 1) { return sum === undefined ? passthroughShaderNode() : zeroShaderNode() } // A fold over no terms is zero
    return loopShaderNode(body, count, idx, sum)
  }

  let loop = (args,e,b,_,er) => {
    let callback = args['value']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let mainChain, probeError
    try {
      mainChain = evalParamEvent(callback, e)
    } catch (err) {
      if (!isLambda) { throw err }
      probeError = err // A body written for a visual loop need not survive being called with no index; the visual call is the real one
    }
    if (isShaderNode(mainChain) || probeError !== undefined) {
      let visual = visualLoop(callback, isLambda, mainChain, args, e, b)
      if (visual !== undefined) { return visual }
      if (probeError !== undefined) { throw probeError } // Not visual after all: the probe's failure was real
    }
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

  // series, parallel and multitap all repeat one chain, differing only in how the repeats are put
  // together. Each repeat is built the same way: a user defined function is called with the repeat
  // index on an event of its own, so per function memoisation cannot collapse every repeat to
  // repeat 0 (descriptors cloned so non-enumerable getters from the fx-chain event survive);
  // anything else is evaluated afresh, since each repeat needs its own nodes. perFrame re-runs the
  // call every frame, for a body that turned out to be an amplitude rather than a chain.
  //
  // The repeat index also goes into the call context as its callsite id, which is what tells the
  // repeats apart in the memo key (getCallTreeString, player/callstack.js). The event of its own
  // covers the build, where every repeat has one; it cannot cover a *px chain*, whose uniforms are
  // re-evaluated every frame against the renderer's single event, long after these have gone. Their
  // ASTs are the one parse instance shared by all the repeats, so without this every octave of
  // parallel{{i}->noise2{scale:scale*(2^i)}, 4} reads back repeat 0's scale. Separated so nesting
  // cannot spell two different index paths the same way.
  let repeatChain = (callback, isLambda, e, b) => (i) => {
    if (!isLambda) {
      return {chain: callback === undefined ? undefined : evalParamFrame(callback, e,b, {doNotMemoise:true})} // Must get new nodes for every repeat
    }
    let ev = Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e))
    let repeatArgs = () => ({value:i, __functionContext:'repeat'+i+';'})
    return {chain: callback(ev, b, evalParamFrame, repeatArgs()), perFrame: (e2,b2,er2) => callback(ev, b2, er2, repeatArgs())}
  }

  // The repeats of a px chain. Repeat 0 has already been built, and the caller only gets here
  // because it came back a visual node: deciding on what was built rather than guessing is what
  // keeps an audio chain from being evaluated speculatively (which would eagerly construct Web Audio
  // nodes), and it means nothing is built twice.
  //
  // A user defined function is called once per repeat, so each really can differ. Anything else is
  // one node reused for every repeat, which is safe because a shader node's build is a pure string
  // emitter and it keeps the repeats sharing one uniform rather than taking one each — uniforms are
  // the scarce resource in a generated shader. A repeat whose body evaluated to a plain value
  // rather than a chain becomes an animated uniform wrapped from the call itself, so it still
  // updates per frame: the visual mirror of the gain wrap the audio paths use.
  let visualChains = (first, chainFor, isLambda, count) => {
    let chains = []
    for (let i = 0; i < count; i++) {
      let repeat = (i === 0 || !isLambda) ? first : chainFor(i)
      chains.push(isShaderNode(repeat.chain) ? repeat.chain : constShaderNode(repeat.perFrame))
    }
    return chains
  }

  // series{chain, count} : repeat the chain count times in series. The chain may be a
  // user defined function given the repeat index (eg {i}->lpf{600*(i+1)}) so each
  // repeat can differ. On a px chain the repeats are composed into the shader instead.
  let series = (args,e,b,_,er) => {
    let count = evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2))
    if (typeof count !== 'number') { throw `series: count ${count} must numeric` }
    if (count < 0) { throw `series: count ${count} must be non-negative` }
    if (count === 0) { return idnode(args,e,b) }
    let callback = args['value']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let chainFor = repeatChain(callback, isLambda, e, b)
    let first = chainFor(0)
    if (isShaderNode(first.chain)) { return seriesShaderNode(visualChains(first, chainFor, isLambda, count)) }
    let node
    for (let i = 0; i<count; i++) {
      let repeat = i === 0 ? first : chainFor(i)
      let chain = repeat.chain
      if (isLambda && !isConnectable(chain)) {
        // The body evaluated to an amplitude, not a node chain. Hand the lambda itself to
        // gain as its value param (reusing the per-repeat ev so memoisation stays isolated)
        // so a frame-varying body gets per-frame updates - same pattern as parallel below
        chain = vars.all().gain({value:repeat.perFrame}, e,b)
      }
      if (node === undefined) { node = chain }
      else { node = connectOp(node, chain, e,b,er) }
    }
    return node
  }
  addNodeFunction('series', series)

  // multitap{{i}->chain, count} : run the chain count times in series like series{}, but
  // tap each stage's output and sum all the taps together as the final output (a tapped
  // line, eg multitap{{i}->echo{1/2}>>gain{0.7^i}, 4} for a decaying multi-tap echo).
  let multitap = (args,e,b,_,er) => {
    let count = Math.floor(evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2)))
    if (typeof count !== 'number' || isNaN(count)) { throw `multitap: count must be numeric` }
    if (count < 1) { return idnode(args,e,b) }
    let callback = args['value'] || args['chain']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let chainFor = repeatChain(callback, isLambda, e, b)
    let first = chainFor(0)
    if (isShaderNode(first.chain)) { return multitapShaderNode(visualChains(first, chainFor, isLambda, count)) }
    let node
    let taps = {}
    for (let i = 0; i < count; i++) {
      let repeat = i === 0 ? first : chainFor(i)
      let chain = repeat.chain
      if (isLambda && !isConnectable(chain)) {
        // The body evaluated to an amplitude, not a node chain. Hand the lambda itself to
        // gain as its value param (reusing the per-stage ev so memoisation stays isolated)
        // so a frame-varying body gets per-frame updates - same pattern as series above
        chain = vars.all().gain({value:repeat.perFrame}, e,b)
      }
      if (!isConnectable(chain)) {
        chain = (chain === undefined) ? idnode(args,e,b) : vars.all().gain({value:chain}, e,b)
      }
      node = (node === undefined) ? chain : connectOp(node, chain, e,b,er)
      taps[i===0 ? 'value' : 'value'+i] = chain
    }
    // Composite: input enters the series chain start (l); output is every stage's chain (r),
    // so connect() resolves each stage's output node and sums them into the destination
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    let composite = Object.create(audioNodeProto)
    composite.l = node
    composite.r = taps
    composite.destructor = e._destructor
    composite.connect = (destination) => {
      return connect(composite.r, destination, e._destructor)
    }
    return composite
  }
  addNodeFunction('multitap', multitap)

  // parallel{{i}->chain, count} : run the chain count times in parallel (default 2):
  // connect() fans the input out to every copy and sums the copies' outputs back
  // together. The chain may be a user defined function given the copy index
  // (eg {i}->lpf{600*(i+1)}) so each copy can differ.
  let parallel = (args,e,b,_,er) => {
    let count = Math.floor(evalMainParamEvent(args, 'count', evalMainParamEvent(args, 'value1', 2)))
    if (typeof count !== 'number' || isNaN(count)) { throw `parallel: count must be numeric` }
    if (count < 1) { return idnode(args,e,b) }
    let callback = args['value'] || args['chain']
    let isLambda = typeof callback === 'function' && callback.isUserFunction
    let chainFor = repeatChain(callback, isLambda, e, b)
    let first = chainFor(0)
    if (isShaderNode(first.chain)) { return parallelShaderNode(visualChains(first, chainFor, isLambda, count)) }
    let result = {}
    for (let i = 0; i < count; i++) {
      let repeat = i === 0 ? first : chainFor(i)
      let proc = repeat.chain
      if (isLambda && !isConnectable(proc)) {
        // The body evaluated to an amplitude, not a node chain. Hand the lambda itself to
        // gain as its value param (reusing the per-copy ev so memoisation stays isolated)
        // so a frame-varying body gets per-frame updates - same pattern as series above
        proc = vars.all().gain({value:repeat.perFrame}, e,b)
      }
      if (!isConnectable(proc)) {
        proc = (proc === undefined) ? idnode(args,e,b) : vars.all().gain({value:proc}, e,b)
      }
      result[i===0 ? 'value' : 'value'+i] = proc
    }
    return result
  }
  addNodeFunction('parallel', parallel)

  let mix = (args,e,b,_,er) => {
    let params = combineParams(args, e)
    let wetChain = evalParamEvent(params.value, e)
    // Visual node chain: compile to a GLSL mix() instead of wiring dry/wet gains. Dispatches on the
    // evalled argument, the same rule the operators and maths functions use, and returns undefined
    // for an ordinary audio mix so nothing below changes.
    let shaderMix = mixShaderNode(params, wetChain, e)
    if (shaderMix !== undefined) { return shaderMix }
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
  let er = (v) => v // passthrough evalRecurse: operands here are already real nodes

  // series: a user defined function chain is invoked once per repeat with the repeat index
  let sCalls = []
  let sCb = (e,b,erFn,a) => { sCalls.push(a.value); return system.audio.createGain() }
  sCb.isUserFunction = true
  let sRes = series({value:sCb, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert([0,1,2], sCalls) // repeat indices passed in order
  assert(true, isConnectable(sRes))

  // series: each repeat gets a distinct event so memoisation can't collapse repeats together
  let sEvents = []
  let sCb2 = (e,b,erFn,a) => { sEvents.push(e); return system.audio.createGain() }
  sCb2.isUserFunction = true
  series({value:sCb2, value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, sEvents[0] !== sEvents[1])

  // loop with a sum: the sum lambda is called with the value first and the index second, and the
  // whole thing comes back as a shader node rather than an audio graph
  let lNode = (tag) => require('draw/visualsynth/shader-node').makeShaderNode((input, ctx) => ctx.addStatement(`${tag}(${input})`))
  let lSumArgs
  let lCb = (e,b,erFn,a) => lNode('a')
  lCb.isUserFunction = true
  let lSumCb = (e,b,erFn,a) => { lSumArgs = a; return lNode('f') }
  lSumCb.isUserFunction = true
  let lRes = loop({value:lCb, value1:3, sum:lSumCb}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isShaderNode(lRes))
  assert(true, isShaderNode(lSumArgs.value)) // the carried value, as a passthrough node
  assert(true, lSumArgs.value1 !== undefined && lSumArgs.value1._loopIndexBox !== undefined) // the loop index
  let lCtx = require('draw/visualsynth/codegen').makeContext()
  lCtx.out = lRes.build(lCtx.rootInput, lCtx)
  assert([
    'vec4 v1 = v0;',
    'vec4 v2 = vec4(0.0);',
    'for (int l_i0 = 0; l_i0 < 3; l_i0++) {',
    '  vec4 v3 = f(v1);',
    '  vec4 v4 = a(v1);',
    '  v2 += v3;',
    '  v1 = v4;',
    '}'], lCtx.statements) // The sum leads the block: it is taken before the body advances the carried value
  assert('v2', lCtx.out) // the total, not the carried value

  // parallel: a user defined function chain is invoked once per copy with the copy index,
  // and the result is a {value,value1,...} map that connect() treats as parallel.
  let pCalls = []
  let pCb = (e,b,erFn,a) => { pCalls.push(a.value); return system.audio.createGain() }
  pCb.isUserFunction = true
  let pRes = parallel({value:pCb, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert([0,1,2], pCalls) // copy indices passed in order
  assert(true, isConnectable(pRes))
  assert(true, pRes.value !== undefined && pRes.value1 !== undefined && pRes.value2 !== undefined && pRes.value3 === undefined)

  // parallel: each copy gets a distinct event so memoisation can't collapse copies together
  let pEvents = []
  let pCb2 = (e,b,erFn,a) => { pEvents.push(e); return system.audio.createGain() }
  pCb2.isUserFunction = true
  parallel({value:pCb2, value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, pEvents[0] !== pEvents[1])

  // parallel: count defaults to 2; no callback gives passthrough identity copies
  let pRes2 = parallel({}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(pRes2))
  assert(true, pRes2.value !== undefined && pRes2.value1 !== undefined && pRes2.value2 === undefined)

  // parallel: count of zero gives a single passthrough
  let pRes3 = parallel({value1:0}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(pRes3))
  assert(true, pRes3.value === undefined) // idnode, not a parallel map

  // multitap: a user defined function chain is invoked once per stage with the stage index
  let mtCalls = []
  let mtCb = (e,b,erFn,a) => { mtCalls.push(a.value); return system.audio.createGain() }
  mtCb.isUserFunction = true
  let mtRes = multitap({value:mtCb, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert([0,1,2], mtCalls) // stage indices passed in order
  assert(true, isConnectable(mtRes))

  // multitap: each stage gets a distinct event so memoisation can't collapse stages together
  let mtEvents = []
  let mtCb2 = (e,b,erFn,a) => { mtEvents.push(e); return system.audio.createGain() }
  mtCb2.isUserFunction = true
  multitap({value:mtCb2, value1:2}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, mtEvents[0] !== mtEvents[1])

  // multitap: stages wire in series, input enters only the first stage, and every stage's
  // output also connects to the destination (where connect() sums them)
  let mtAnProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain()))
  let mtMock = (name) => {
    let an = Object.create(mtAnProto)
    an.name = name
    an.connected = []
    an.connect = (v) => { an.connected.push(v.name) }
    Object.defineProperty(an, "numberOfInputs", { get() { return 1 } })
    return an
  }
  let mtStages = []
  let mtCb3 = (e,b,erFn,a) => { let n = mtMock('stage'+a.value); mtStages.push(n); return n }
  mtCb3.isUserFunction = true
  let mtRes3 = multitap({value:mtCb3, value1:3}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  let mtSrc = mtMock('src')
  connect(mtSrc, mtRes3, undefined)
  assert(['stage0'], mtSrc.connected) // input does NOT fan out to the taps
  connect(mtRes3, mtMock('dest'), undefined)
  assert(['stage1','dest'], mtStages[0].connected) // feeds next stage, taps to dest
  assert(['stage2','dest'], mtStages[1].connected)
  assert(['dest'], mtStages[2].connected) // last stage just taps to dest

  // multitap: count of zero gives a single passthrough, not a tap map
  let mtRes4 = multitap({value1:0}, {_destructor:require('play/destructor')()}, 0, undefined, er)
  assert(true, isConnectable(mtRes4))
  assert(true, mtRes4.value === undefined) // idnode, not a parallel map

  // mix: a visual node argument compiles to a shader node instead of wiring dry/wet gains,
  // while an audio chain still gets the gain pair
  let mixEvent = {count:0, _destructor:require('play/destructor')()}
  let mixNode = mix({value:{isShaderNode:true, build:(i)=>i}, value1:1/2}, mixEvent, 0, undefined, er)
  assert(true, mixNode.isShaderNode)
  let mixAudio = mix({value:mtMock('wet'), value1:1/2}, mixEvent, 0, undefined, er)
  assert(true, isConnectable(mixAudio.value) && isConnectable(mixAudio.value1)) // dry and wet parts

  // series, parallel and multitap on a px chain: dispatched on what repeat 0 came back as, and the
  // repeats compiled into one shader rather than wired into an audio graph
  let {makeContext} = require('draw/visualsynth/codegen')
  let vNode = (tag) => ({isShaderNode:true, build:(input,ctx) => ctx.addStatement(`${tag}(${input})`)})
  let vEvent = () => ({count:0, _destructor:require('play/destructor')()})
  let vCalls = []
  let vCb = (e,b,erFn,a) => { vCalls.push(a.value); return vNode('r'+a.value) }
  vCb.isUserFunction = true
  let vBuild = (node) => { let ctx = makeContext(); ctx.out = node.build(ctx.rootInput, ctx); return ctx.statements }

  let vSeries = series({value:vCb, value1:3}, vEvent(), 0, undefined, er)
  assert(true, isShaderNode(vSeries))
  assert([0,1,2], vCalls) // The lambda is called once per repeat, with the repeat index
  assert(['vec4 v1 = r0(v0);', 'vec4 v2 = r1(v1);', 'vec4 v3 = r2(v2);'], vBuild(vSeries)) // Each repeat consumes the last

  vCalls = []
  let vPar = parallel({value:vCb, value1:3}, vEvent(), 0, undefined, er)
  assert(true, isShaderNode(vPar)) // A shader node, not the {value,value1} map audio gets
  assert([0,1,2], vCalls)
  assert(['vec4 v1 = r0(v0);', 'vec4 v2 = r1(v0);', 'vec4 v3 = r2(v0);', 'vec4 v4 = v1 + v2 + v3;'], vBuild(vPar))

  vCalls = []
  let vMt = multitap({value:vCb, value1:3}, vEvent(), 0, undefined, er)
  assert(true, isShaderNode(vMt))
  assert(['vec4 v1 = r0(v0);', 'vec4 v2 = r1(v1);', 'vec4 v3 = r2(v2);', 'vec4 v4 = v1 + v2 + v3;'], vBuild(vMt))

  // A body that isn't a user defined function is one node reused for every repeat: build is a pure
  // emitter, so the repeats differ by their input alone and share one uniform rather than taking one each
  assert(['vec4 v1 = a(v0);', 'vec4 v2 = a(v1);', 'vec4 v3 = a(v2);'],
         vBuild(series({value:vNode('a'), value1:3}, vEvent(), 0, undefined, er)))

  // A repeat whose body evaluated to a plain value rather than a chain becomes an animated uniform
  let mixedCb = (e,b,erFn,a) => a.value === 0 ? vNode('r0') : 2
  mixedCb.isUserFunction = true
  assert(['vec4 v1 = r0(v0);', 'vec4 v2 = u_vs0;', 'vec4 v3 = v1 + v2;'],
         vBuild(parallel({value:mixedCb, value1:2}, vEvent(), 0, undefined, er)))

  // loop on a px chain is a real GLSL for loop: the body is emitted once, however big the count
  let loopCalls = []
  let loopCb = (e,b,erFn,a) => { loopCalls.push(a === undefined ? 'probe' : a.value); return vNode('b') }
  loopCb.isUserFunction = true
  let vLoop = loop({value:loopCb, value1:4}, vEvent(), 0, undefined, er)
  assert(true, isShaderNode(vLoop))
  assert(2, loopCalls.length) // Probed with no index at all, then called for real with one
  assert('probe', loopCalls[0])
  assert(true, isShaderNode(loopCalls[1])) // The index is a value in the shader, not a javascript number
  assert(['vec4 v1 = v0;', 'for (int l_i0 = 0; l_i0 < 4; l_i0++) {', '  vec4 v2 = b(v1);', '  v1 = v2;', '}'], vBuild(vLoop))

  // A loop body that isn't a user defined function needs no second call, and gets no index
  let vLoop2 = loop({value:vNode('b'), value1:2}, vEvent(), 0, undefined, er)
  assert(['vec4 v1 = v0;', 'for (int l_i0 = 0; l_i0 < 2; l_i0++) {', '  vec4 v2 = b(v1);', '  v1 = v2;', '}'], vBuild(vLoop2))

  // A visual loop with no iterations passes the value through, rather than dropping out of the
  // visual domain the way the audio idnode would
  assert(true, isShaderNode(loop({value:vNode('b'), value1:0}, vEvent(), 0, undefined, er)))

  // An audio loop{} is untouched: a lambda body is called once, with no index, exactly as before
  let audioCalls = []
  let audioCb = (e,b,erFn,a) => { audioCalls.push(a); return system.audio.createGain() }
  audioCb.isUserFunction = true
  let aLoop = loop({value:audioCb, value1:system.audio.createGain()}, vEvent(), 0, undefined, er)
  assert([undefined], audioCalls)
  assert(true, aLoop instanceof AudioNode)

  console.log('Graph tests complete')
  }
})
