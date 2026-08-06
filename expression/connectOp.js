'use strict';
define(function(require) {
  let system = require('play/system');
  let {connect,isConnectable,isConnectableOrPlaceholder} = require('play/nodes/connect');
  let destructor = require('play/destructor')
  let {evalParamFrame} = require('player/eval-param')
  let vars = require('vars')
  let {isShaderNode,composeShaderNodes,constShaderNode} = require('draw/visualsynth/shader-node')

  let audioNodeProto
  let getAudioNodeProto = () => {
    if (audioNodeProto === undefined) { audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(system.audio.createGain())) }
    return audioNodeProto
  }

  let connectOp = (l,r, e,b,evalRecurse) => {
    if (l === undefined) { return r }
    if (r === undefined) { return l }
    let el = evalRecurse(l, e,b)
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
    // A 0 is only a real "empty chord slot" placeholder during chord expansion (expandingChords).
    // In normal playback a value that resolves to 0 (eg a timevar like duck at its start) is genuine
    // and must be wrapped in a gain node, otherwise connect() resolves it to [] and the chain goes
    // silent. So use the strict isConnectable in normal playback, and only accept placeholders while
    // expanding chords. (cf 01a8372c, which made the same fix in player-fx.js and graph.js)
    let expandingChords = evalRecurse && evalRecurse.options && evalRecurse.options.expandingChords
    let connectable = expandingChords ? isConnectableOrPlaceholder : isConnectable
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

  console.log("connectOp tests complete")
  }

  return connectOp
})