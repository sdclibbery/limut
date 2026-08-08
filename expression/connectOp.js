'use strict';
define(function(require) {
  let system = require('play/system');
  let {connect,isConnectable,isConnectableOrPlaceholder} = require('play/nodes/connect');
  let destructor = require('play/destructor')
  let {evalParamFrame,evalFunctionWithModifiers} = require('player/eval-param')
  let vars = require('vars')
  let {isShaderNode,composeShaderNodes,constShaderNode,passthroughShaderNode} = require('draw/visualsynth/shader-node')

  let audioNodeProto
  let getAudioNodeProto = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    return audioNodeProto
  }

  // A call that >> can pipe its left hand side into. Node functions are excluded: they are wired,
  // not called, so `osc{}>>lpf{500}` stays a connection rather than becoming lpf{oscNode,500}.
  // They are marked by addNodeFunction (play/nodes/node-var.js) and parse-var passes the mark on.
  let isPipeTarget = (v) => {
    if (typeof v !== 'function' || !v.isVarLookup || v._chordPlaceholder) { return false }
    let target = vars.get(v._name)
    return typeof target === 'function' && target.isVarFunction // A var function or a user defined one
  }

  let connectOp = (l,r, e,b,evalRecurse) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    let el = evalRecurse(l, e,b)
    // A 0 is only a real "empty chord slot" placeholder during chord expansion (expandingChords).
    // In normal playback a value that resolves to 0 (eg a timevar like duck at its start) is genuine
    // and must be wrapped in a gain node, otherwise connect() resolves it to [] and the chain goes
    // silent. So use the strict isConnectable in normal playback, and only accept placeholders while
    // expanding chords. (cf 01a8372c, which made the same fix in player-fx.js and graph.js)
    let expandingChords = evalRecurse && evalRecurse.options && evalRecurse.options.expandingChords
    let connectable = expandingChords ? isConnectableOrPlaceholder : isConnectable
    // Pipe: >> feeds the left into the right, and for anything that isn't an audio node that means
    // passing it as the first argument, so `a>>foo{2}` is foo{a,2}. Audio keeps its wire: a
    // connectable left side means DSL defined effects like `shifter{2}>>reverb{1b}` still connect
    // rather than calling reverb with an AudioNode for its length. Decided from the unevalled RHS so
    // it is never evalled twice, which would return the memoised un-piped result anyway.
    if (isPipeTarget(r) && !connectable(el)) {
      // A visual chain piped into a call is handed a pass-through node rather than the chain
      // itself, and the call's result is composed back on. The incoming value then reaches the
      // result both ways: through the argument (dot{in,#3b1}) and as the segment's own input
      // (the dry side of mix{wet,t}), so a user defined function really is a chain segment
      // rather than a new chain starting from the raw coordinate. Substituting matters because
      // composing the chain onto a result that already embeds it would apply it twice.
      let piping = isShaderNode(el)
      let saved = r.args
      r.args = piping ? passthroughShaderNode() : el // Same mechanism as lookupOp (a.foo), but
      let v = evalFunctionWithModifiers(r, e,b, evalRecurse) // restore it: this parse instance is
      r.args = saved // also reachable down paths that don't pipe
      if (typeof v === 'object' && v !== null && v._finalResult) { v = v.value }
      v = evalRecurse(v, e,b)
      if (piping && isShaderNode(v)) { return composeShaderNodes(el, v) }
      return v
    }
    let er = evalRecurse(r, e,b)
    // Visual synth chains: if either side is a shader node, compose GLSL emitters instead of
    // wiring audio. A non-node operand becomes an animated uniform, wrapped from its raw AST
    // (mirroring the gain{value:l} wrap below).
    if (isShaderNode(el) || isShaderNode(er)) {
      return composeShaderNodes(
        isShaderNode(el) ? el : constShaderNode(l),
        isShaderNode(er) ? er : constShaderNode(r)
      )
    }
    let composite = Object.create(getAudioNodeProto()) // Create object that satisfies instanceof AudioNode
    composite.destructor = destructor(!!(e && e._destructor && e._destructor.canPool)) // Inherit poolability from the owning event's destructor
    if (!connectable(el)) {
      el = vars.all().gain({value:l}, e,b) // Allow connecting to/from l value by wrapping into gain
    }
    if (!connectable(er)) {
      er = vars.all().gain({value:r}, e,b) // Allow connecting to r value by wrapping into gain
    }
    composite.l = el
    composite.r = er
    connect(composite.l, composite.r, composite.destructor)
    composite.connect = (destination) => {
      return connect(composite.r, destination, composite.destructor)
    }
    composite.disconnect = () => {
      composite.destructor.destroy()
    }
    if (e && e._destructor) { e._destructor.disconnect(composite) }
    return composite
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {
    
  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let mockAn = () => {
    let an = Object.create(getAudioNodeProto())
    an.connect = () => {}
    an.disconnect = () => { an.disconnected = true }
    Object.defineProperty(an, "numberOfInputs", { get() { return 1 } })
    return an
  }
  let l, r
  let an
  
  an = mockAn()
  assert(an, connectOp(an, undefined, {},0,x=>x))
  assert(an, connectOp(undefined, an, {},0,x=>x))

  l = mockAn()
  r = mockAn()
  an = connectOp(l, r, {},0,x=>x)
  assert(true, an instanceof AudioNode)
  an.disconnect()
  assert(true, l.disconnected)
  assert(true, r.disconnected)

  // A value that resolves to 0 in normal playback must be wrapped in a gain node, not treated as an
  // empty chord-slot placeholder (which connect() resolves to nothing -> silence). This covers both a
  // bare 0 and a timevar segment object like duck's {value:0,...} at its start (the reported bug).
  // The gain node-function may not be registered yet at test time, so stub it.
  let savedGain = vars.all().gain
  vars.all().gain = (args) => { let n = mockAn(); n.value = args.value; return n }
  let erZero = (v,e,b) => v === 'bareZero' ? 0 : (v === 'segZero' ? {value:0, _nextSegment:1, _segmentPower:3} : v)

  an = connectOp(mockAn(), 'bareZero', {},0, erZero)
  assert(true, an.r instanceof AudioNode) // bare 0 wrapped, not left as a placeholder

  an = connectOp(mockAn(), 'segZero', {},0, erZero)
  assert(true, an.r instanceof AudioNode) // duck-style {value:0,...} wrapped, not dropped to silence

  // But during chord expansion (expandingChords), a 0 IS a placeholder and must be preserved.
  let erZeroExpand = (v,e,b) => v === 'bareZero' ? 0 : v
  erZeroExpand.options = {expandingChords:true}
  an = connectOp(mockAn(), 'bareZero', {},0, erZeroExpand)
  assert(0, an.r) // placeholder kept
  vars.all().gain = savedGain

  // Shader nodes: >> composes GLSL emitters instead of wiring audio
  let mockShaderNode = (tag) => ({isShaderNode: true, build: (input, ctx) => { ctx.statements.push(tag); return input }})
  let mockCtx = () => ({statements: [], uniforms: [], addStatement: function(x) { this.statements.push(x); return 'v1' }, addUniform: function(ast) { this.uniforms.push(ast); return 'u_vs0' }})
  let sn
  sn = connectOp(mockShaderNode('a'), mockShaderNode('b'), {},0, x=>x)
  assert(true, sn.isShaderNode)
  assert(false, sn instanceof AudioNode)
  let sctx = mockCtx()
  sn.build('v0', sctx)
  assert(['a','b'], sctx.statements) // left emits first, right consumes
  // A non-node operand next to a shader node becomes a const uniform wrapping the raw AST
  let rawAst = 'theRawAst'
  sn = connectOp(rawAst, mockShaderNode('b'), {},0, v => v === rawAst ? 0.5 : v)
  assert(true, sn.isShaderNode)
  sctx = mockCtx()
  sn.build('v0', sctx)
  assert([rawAst], sctx.uniforms) // raw AST registered as uniform, not the evaluated 0.5

  // Pipe: >> feeds the left side into a non-node call as its first argument
  let {varLookup} = require('expression/parse-var')
  let pipeArgs
  vars.all().mockpipe = (args) => { pipeArgs = args; return 'piped' }
  vars.all().mockpipe.isVarFunction = true
  vars.all().mocknodefn = (args) => 'nodefn'
  vars.all().mocknodefn.isVarFunction = true
  vars.all().mocknodefn._chordPlaceholder = true // As set by addNodeFunction
  let mockLookup = (args) => varLookup('mockpipe', args, {})

  assert('piped', connectOp(2, mockLookup({value:3}), {},0, evalParamFrame))
  assert([2,3], [pipeArgs.value, pipeArgs.value1]) // Left side becomes the first arg, existing args shift up

  pipeArgs = undefined
  sn = connectOp(mockShaderNode('a'), mockLookup({value:3}), {},0, evalParamFrame)
  assert('piped', sn) // A non-node result is returned as it stands, with nothing composed on
  assert(true, pipeArgs.value !== undefined && pipeArgs.value.isShaderNode) // Visual node arrives as an arg

  // A visual chain is piped in as a pass-through node, and a visual result is composed back onto
  // the chain: the incoming value reaches the result through the arg AND as the result's own
  // input, and the chain is emitted once rather than once per use of the arg
  let pipedArg
  vars.all().mockpipe = (args) => { pipedArg = args.value; return mockShaderNode('b') }
  vars.all().mockpipe.isVarFunction = true
  sn = connectOp(mockShaderNode('a'), mockLookup({}), {},0, evalParamFrame)
  assert(true, sn.isShaderNode)
  sctx = mockCtx()
  sn.build('v0', sctx)
  assert(['a','b'], sctx.statements) // composed: the left side emits first, the result consumes it
  let pctx = mockCtx()
  pipedArg.build('v0', pctx)
  assert(['v0'], pctx.statements) // what the callee got passes its input through; it is not the chain
  vars.all().mockpipe = (args) => { pipeArgs = args; return 'piped' }
  vars.all().mockpipe.isVarFunction = true

  let lk = mockLookup({value:3}) // r.args must not be left set: the same parse instance is
  connectOp(2, lk, {},0, evalParamFrame) // also reachable down paths that don't pipe
  assert(undefined, lk.args)

  vars.all().gain = (args) => { let n = mockAn(); n.value = args.value; return n }

  // A connectable left side keeps the wire, so DSL defined effects (shifter{2}>>reverb{1b}) still connect
  pipeArgs = undefined
  an = connectOp(mockAn(), mockLookup({value:3}), {},0, evalParamFrame)
  assert(true, an instanceof AudioNode)
  assert([3,undefined], [pipeArgs.value, pipeArgs.value1]) // Called normally, not piped

  // Node functions are wired, not called: osc{}>>lpf{500} must not become lpf{oscNode,500}
  an = connectOp(2, varLookup('mocknodefn', undefined, {}), {},0, evalParamFrame)
  assert(true, an instanceof AudioNode)

  // No piping during chord expansion, where a 0 is a placeholder for a node that isn't built yet
  pipeArgs = undefined
  let erExpand = (v,e,b) => evalParamFrame(v,e,b)
  erExpand.options = {expandingChords:true}
  an = connectOp(0, mockLookup({value:3}), {},0, erExpand)
  assert(true, an instanceof AudioNode)
  assert([3,undefined], [pipeArgs.value, pipeArgs.value1])

  vars.all().gain = savedGain
  delete vars.all().mockpipe
  delete vars.all().mocknodefn

  console.log("connectOp tests complete")
  }

  return connectOp
})