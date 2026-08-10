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

  // The head of an arithmetic expression is its leftmost leaf: `id >> floor{[]n}+1/2` must feed
  // floor, just as `id >> floor{[]n} >> add{1/2}` does. >> binds looser than arithmetic, so the
  // whole expression arrives as the right hand side and the call that wants the incoming value is
  // buried inside it. Only operators that compile to GLSL carry _shaderOpLhs (eval-operator.js),
  // so this never walks into `.` (which would mean mutating p1 in `p1.amp`) or `|`.
  let expressionHead = (r) => {
    while (typeof r === 'function' && r._shaderOpLhs !== undefined) { r = r._shaderOpLhs }
    return r
  }

  // Call the right hand side with `arg` as its first argument (undefined for no piped argument at
  // all). Same mechanism as lookupOp (a.foo); r.args is restored because the same parse instance is
  // also reachable down paths that don't pipe.
  let callWithPipedArg = (r, arg, e,b, evalRecurse) => {
    let saved = r.args
    r.args = arg
    let v = evalFunctionWithModifiers(r, e,b, evalRecurse)
    r.args = saved
    if (typeof v === 'object' && v !== null && v._finalResult) { v = v.value }
    return evalRecurse(v, e,b)
  }

  // Was this call already handed a visual node of its own? That is what says whether it wants the
  // chain input as well: `abs{sin{id*4}}` and `dot{tex{'a.png'},#3b1}` have their operand already,
  // where `floor{[]n}`, `pixellate{40}` and a bare `swap` do not. Asking the call itself (does it
  // return a node?) does not work — a function whose body is a node function, eg
  // `set rot = {in,a} -> set{u:...}`, returns one however little sense its arguments made.
  // Args are evalled in the caller's context, which is where they are written, and memoisation
  // makes the call itself see the same values. Lambda args are left alone: calling one bare here
  // would evaluate its body with no call context (see evalModifiers in eval-param.js).
  let hasShaderNodeArg = (r, e,b, evalRecurse) => {
    for (let k in r.ownArgs) {
      let arg = r.ownArgs[k]
      if (typeof arg === 'function' && arg.isUserFunction) { continue }
      if (isShaderNode(evalRecurse(arg, e,b))) { return true }
    }
    return false
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
      // The chain seed (the id node, and so the implicit start of every px chain) is offered rather
      // than forced: a call already holding a visual node keeps its own arguments, so the argument
      // forms still mean what they say (abs{sin{id*4}}, dot{tex{'a.png'},#3b1}). A call with no node
      // of its own (floor{[]n}, pixellate{40}, a bare swap) takes the incoming value as its first
      // argument, which is what makes `px=X` mean `px=id>>X`.
      if (piping && el._implicitInput && hasShaderNodeArg(r, e,b, evalRecurse)) {
        return callWithPipedArg(r, undefined, e,b, evalRecurse)
      }
      let v = callWithPipedArg(r, piping ? passthroughShaderNode() : el, e,b, evalRecurse)
      if (piping && isShaderNode(v)) { return composeShaderNodes(el, v) }
      return v
    }
    // Same thing one level in: a visual chain met by an arithmetic expression feeds the call at the
    // head of that expression, so `px=floor{[]n}+1/2` means `px=floor{[]n}>>add{1/2}` and
    // `px=id>>sin*#0f0` means `px=id>>sin>>mul{#0f0}`. The head takes the value the way any other
    // piped call does (parse-var reads .args to shift its own args up), and the expression around it
    // then evaluates as written. Visual only: audio >> keeps its wire.
    if (isShaderNode(el)) {
      let head = expressionHead(r)
      // head === r is the plain call above; a head that isn't a call (a number, or `id` itself in
      // `id/2+floor{1/8}`) wants nothing, which is what keeps that form adding a constant.
      if (head !== r && isPipeTarget(head)
          && !(el._implicitInput && hasShaderNodeArg(head, e,b, evalRecurse))) {
        let saved = head.args
        head.args = passthroughShaderNode()
        let v = evalRecurse(r, e,b)
        head.args = saved
        // A head that isn't shader aware (eg `px=rand+1/2`) gives back a plain value: wrap the raw
        // AST as a uniform, as the compose branch below would have done, rather than dropping out
        // of the visual domain altogether.
        return composeShaderNodes(el, isShaderNode(v) ? v : constShaderNode(r))
      }
    }
    let er = evalRecurse(r, e,b)
    // Visual synth chains: if either side is a shader node, compose GLSL emitters instead of
    // wiring audio. A non-node operand becomes an animated uniform, wrapped from its raw AST
    // (mirroring the gain{value:l} wrap below).
    if (isShaderNode(el) || isShaderNode(er)) {
      // The chain seed does nothing to what follows it, so hand that back as it stands rather than
      // composing. Composing would wrap it in an ordinary node, and `id>>id>>abs{sin{id*4}}` (ie an
      // explicit id on a param that is seeded anyway) would then force the input into abs and drop
      // its argument. Only for a node: `id>>#f00` still wraps the colour into a uniform.
      if (isShaderNode(el) && el._implicitInput && isShaderNode(er)) { return er }
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

  // The implicit chain seed (the id node, at the head of every px chain) is offered to the call
  // rather than forced on it: a call already holding a visual node of its own keeps its arguments
  let {implicitInputNode} = require('draw/visualsynth/shader-node')
  let calls
  vars.all().mockpipe = (args) => { calls.push(args); return mockShaderNode('b') }
  vars.all().mockpipe.isVarFunction = true
  calls = []
  lk = mockLookup({value: mockShaderNode('c'), value1: 3})
  sn = connectOp(implicitInputNode(), lk, {},0, evalParamFrame)
  assert(true, sn.isShaderNode)
  assert(1, calls.length) // Not piped, and its args don't shift: `px=abs{sin{id*4}}` keeps its operand
  assert([true, 3], [isShaderNode(calls[0].value), calls[0].value1])
  assert(undefined, lk.args)
  sctx = mockCtx()
  sn.build('v0', sctx)
  assert(['b'], sctx.statements) // Nothing composed on either: the seed emits nothing

  // A call with no visual node of its own gets the incoming value as its first argument
  calls = []
  lk = mockLookup({value:3})
  sn = connectOp(implicitInputNode(), lk, {},0, evalParamFrame)
  assert(true, sn.isShaderNode)
  assert(1, calls.length)
  assert(true, isShaderNode(calls[0].value)) // `px=floor{[]n}` becomes floor{id,[]n}
  assert(3, calls[0].value1) // and the existing args shift up
  assert(undefined, lk.args)

  calls = [] // A lambda arg is skipped rather than called bare, so it still counts as 'no node'
  let lambda = () => 0
  lambda.isUserFunction = true
  connectOp(implicitInputNode(), mockLookup({value: lambda}), {},0, evalParamFrame)
  assert(true, isShaderNode(calls[0].value)) // Piped: a lambda is not a node, so the input is wanted

  // >> binds looser than arithmetic, so `px=floor{[]n}+1/2` arrives here as a whole expression. The
  // call at its head takes the incoming value just as it would in `floor{[]n}>>add{1/2}`.
  let operatorAst = require('expression/eval-operator')
  let {shaderNodeOps} = require('expression/shaderNodeOps')
  let shaderAdd = (l,r)=>l+r
  shaderAdd.shaderNodeOp = shaderNodeOps['+']
  calls = []
  lk = mockLookup({value:3})
  sn = connectOp(implicitInputNode(), operatorAst(shaderAdd, lk, 2), {},0, evalParamFrame)
  assert(true, isShaderNode(sn))
  assert(1, calls.length)
  assert(true, isShaderNode(calls[0].value)) // The head is called as floor{id,[]n}
  assert(3, calls[0].value1) // and its own args shift up
  assert(undefined, lk.args) // .args restored: the parse instance is reachable down other paths
  sctx = mockCtx()
  sn.build('v0', sctx)
  assert(['b', 'v0 + u_vs0'], sctx.statements) // The head emits once, then the operator combines

  calls = [] // A head already holding a node keeps its args, as `px=abs{sin{id*4}}*2` must
  lk = mockLookup({value: mockShaderNode('c'), value1: 3})
  sn = connectOp(implicitInputNode(), operatorAst(shaderAdd, lk, 2), {},0, evalParamFrame)
  assert(true, isShaderNode(sn))
  assert([true, 3], [isShaderNode(calls[0].value), calls[0].value1])

  calls = [] // Only the head of the expression is offered the value: `id/2+floor{1/8}` adds a constant
  lk = mockLookup({})
  sn = connectOp(implicitInputNode(), operatorAst(shaderAdd, 2, lk), {},0, evalParamFrame)
  assert(true, isShaderNode(sn))
  assert(undefined, calls[0].value) // Not piped: the head is the 2, which wants nothing

  vars.all().mockpipe = (args) => { calls.push(args); return 'notanode' } // Not shader aware
  vars.all().mockpipe.isVarFunction = true
  calls = []
  lk = mockLookup({})
  sn = connectOp(implicitInputNode(), operatorAst(shaderAdd, lk, 2), {},0, evalParamFrame)
  assert(true, isShaderNode(sn)) // Still visual: the whole expression becomes an animated uniform
  assert(undefined, lk.args)

  vars.all().mockpipe = (args) => { pipeArgs = args; return 'piped' }
  vars.all().mockpipe.isVarFunction = true

  vars.all().gain = (args) => { let n = mockAn(); n.value = args.value; return n }

  // A connectable left side keeps the wire, so DSL defined effects (shifter{2}>>reverb{1b}) still connect
  pipeArgs = undefined
  an = connectOp(mockAn(), mockLookup({value:3}), {},0, evalParamFrame)
  assert(true, an instanceof AudioNode)
  assert([3,undefined], [pipeArgs.value, pipeArgs.value1]) // Called normally, not piped

  pipeArgs = undefined // Audio is untouched by the head rule too: an arithmetic right hand side stays a wire
  an = connectOp(mockAn(), operatorAst(shaderAdd, mockLookup({value:3}), 2), {},0, evalParamFrame)
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