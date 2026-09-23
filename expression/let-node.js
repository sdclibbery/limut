'use strict'
define(function(require) {
  let vars = require('vars')
  let addVarFunction = require('predefined-vars').addVarFunction
  let consoleOut = require('console')
  let connectOp = require('expression/connectOp')
  let {evalParamFrame} = require('player/eval-param')
  let {makeShaderNode,isShaderNode,implicitInputNode,constShaderNode} = require('draw/visualsynth/shader-node')

  // `let` names the value at a point in a chain (or names a separate expression) and passes the
  // chain through unchanged, so the name can be used again further along:
  //   px=sdstar>>let{'foo'}>>tex{webcam}>>mul{foo}
  //   fx=let{'foo'}>>reverb>>panner{foo}
  //   px=fbm2>>let{'wc',[]n^2}>>cospal{wc,wc}
  //   px=fbm2>>let{'wc',uv>>tex{webcam}}>>cospal{wc,wc}
  //
  // A pxfn{} is the exception: it is bound as the function it is, rather than as the value it takes
  // where the let is written, so an sdf3 scene can be declared inline on the line that marches it:
  //   px=let{'scene',pxfn{sd3torus}}>>sd3march{scene}>>sd3lit{scene}
  //
  // Bindings hang off the event, whose lifetime matches a chain's: a visual chain's uniforms are
  // re-evaluated against it every frame, and a persistent fx chain (play/player-fx.js) reads its
  // params for its whole life. So a let is visible anywhere later in that event's params, including
  // inside a user function the chain calls. The read side is in parse-var.js.

  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  // Resolve the bound expression on a cloned event, for the same reason as paramChain in
  // draw/visualsynth/nodes.js (see ownEvent there): the modifier machinery's un-piped memo must not
  // leak in, and doNotMemoise would multiply the built chain.
  let ownEvent = (e) => {
    if (e === undefined || e === null) { return e }
    // Bindings are shared rather than copied, so a `let` *inside* the bound expression still lands
    // on the real event exactly as it did before
    if (e._lets === undefined) { e._lets = {} }
    return Object.create(Object.getPrototypeOf(e), Object.getOwnPropertyDescriptors(e))
  }
  // With no event there is nothing to isolate and nothing to memoise against - the memo is a
  // WeakMap keyed on the event - so that case keeps the old doNotMemoise behaviour
  let memoScoped = (evalRecurse, canMemoise) => {
    let options = Object.assign({}, evalRecurse !== undefined ? evalRecurse.options : undefined)
    if (canMemoise) { delete options.doNotMemoise } else { options.doNotMemoise = true }
    let er = (v, e, b, more) => evalParamFrame(v, e, b, more !== undefined ? Object.assign({}, options, more) : options)
    er.options = options // >> reads expandingChords off here
    return er
  }

  // The name is a quoted string ('foo') or a bare word. >> shifts positional args up when it pipes,
  // so the name is in value or value1: search the positional args rather than counting. Whatever
  // follows is the bound expression.
  //
  // A bare word is taken as written, off the raw AST (let has dontEvalArgs), like the global. lookup
  // and shaderSwizzle. Evaluating it would fail for a name that is already bound (a loop{} carry,
  // or a name bound by the loop{} probe call), since it evaluates to its binding. So let{nm} names
  // nm even if nm holds a string; use let{'foo'} for a literal name.
  let nameSlots = ['value', 'value1']
  let bareName = (a) => typeof a === 'function' && a.isVarLookup && !a.hasOwnArgs && !a.namespace ? a._name : undefined
  let findName = (args, e, b, er) => {
    for (let i = 0; i < nameSlots.length; i++) {
      let slot = nameSlots[i]
      if (args[slot] === undefined) { continue }
      let found = {slot: slot, boundSlot: 'value'+(i+1)}
      let bare = bareName(args[slot])
      // parseVar lowercases bare names but parseString does not, so `let{'Foo'}` must still answer to `foo`
      if (bare !== undefined) { return Object.assign(found, {name: bare.toLowerCase()}) }
      let v = er(args[slot], e, b)
      if (typeof v === 'string') { return Object.assign(found, {name: v.toLowerCase()}) }
    }
    return undefined
  }

  let bindLet = (e, name, value) => {
    if (e === undefined || e === null) { warnOnce(`🟠 let '${name}' has no event to bind to`); return }
    if (e._lets === undefined) { e._lets = {} }
    if (e._lets[name] === undefined && vars.get(name) !== undefined) {
      warnOnce(`🟠 let '${name}' shadows an existing name for the rest of the chain`)
    }
    e._lets[name] = value
  }

  // The definition node, returned into the chain: its build records the GLSL variable holding the
  // value at this point. The tap form emits no statement.
  //
  // A loop{} carry: name already has a variable declared outside the loop (shader-repeat.js), so
  // this assigns it in place, and every read of the name - in the body, until: and after the loop -
  // sees it. Both the assignment and reads set ctx.volatile, which stops ctx.built handing back a
  // variable computed before the assignment (makeShaderNode, shader-node.js).
  let letShaderNode = (name, bound) => {
    return makeShaderNode((input, ctx) => {
      if (ctx.lets === undefined) { ctx.lets = {} } // A context that predates ctx.lets (or a test mock)
      let v = bound !== undefined ? bound.build(input, ctx) : input
      let carried = ctx.carried !== undefined ? ctx.carried[name] : undefined
      if (carried !== undefined) {
        ctx.addRaw(`${carried} = ${v};`)
        ctx.volatile = true // the assignment itself must be emitted wherever it is written
      } else {
        ctx.lets[name] = v
      }
      return input
    })
  }

  // What the name resolves to. It allocates no name of its own — it hands back the one the
  // definition recorded during this same build walk — so the source stays deterministic, and two
  // uses of the name share one variable rather than emitting the subtree twice.
  let letRefShaderNode = (name) => {
    return makeShaderNode((input, ctx) => {
      let v = ctx.lets !== undefined ? ctx.lets[name] : undefined
      if (v === undefined) { warnOnce(`🟠 let '${name}' is used before it is set`); return input }
      // A carried value's variable is assigned in the loop body, so what it holds depends on where
      // in the body this read happens: nothing that reads one may be memoised. See makeShaderNode.
      if (ctx.carried !== undefined && ctx.carried[name] !== undefined) { ctx.volatile = true }
      return v
    })
  }

  let passShaderNode = () => makeShaderNode((input, ctx) => input)

  let letNode = (args, e, b, state, evalRecurse) => {
    // During chord expansion a node function holds a placeholder slot rather than building anything;
    // that is what addNodeFunction's _chordPlaceholder buys. `let` is deliberately not registered
    // that way — it has to be a pipe target so >> hands it the chain value (see below) — so it does
    // the same thing itself, rather than making a gain node per chord slot and leaking every one.
    if (evalRecurse !== undefined && evalRecurse.options && evalRecurse.options.expandingChords) { return 0 }
    // The bound expression is evaluated against an event of its own; everything that outlives this
    // call (bindLet, the audio tap gain) still uses the real one
    let ev = ownEvent(e)
    let er = memoScoped(evalRecurse !== undefined ? evalRecurse : evalParamFrame, ev !== undefined && ev !== null)
    let found = args !== undefined && args !== null ? findName(args, ev, b, er) : undefined
    if (found === undefined) {
      warnOnce(`🟠 let needs a name, eg let{'foo'}`)
      return isShaderNode(args && args.value) ? passShaderNode() : vars.all().gain({value:1}, e,b)
    }
    let name = found.name
    let pipedValue = found.slot === 'value1' ? args.value : undefined
    let boundAst = args[found.boundSlot]
    let boundValue = boundAst !== undefined ? er(boundAst, ev, b) : undefined

    // Which domain, decided without asking connectOp. In a visual chain let is always piped (the
    // left side is a shader node, and px params are written id>>...), except for a call already
    // holding a visual node, which >> withholds the seed from - and then the bound expression is
    // itself visual. In an audio chain let is never piped.
    let visual = isShaderNode(pipedValue) || isShaderNode(boundValue)

    if (visual) {
      // A pxfn{} is a function of a point, so it is bound unbuilt and each use site builds its own
      // call, as a set name would. Building it here would bind its value at this point (for a scene
      // at the head of a px chain, a constant slice), which a march cannot step through.
      // Nothing is emitted and the seed passes through unchanged, so >> still withholds the seed
      // from a call holding a node (connectOp.js), keeping the scene out of sd3march's in.
      if (isShaderNode(boundValue) && boundValue._isPxFunction) {
        bindLet(e, name, boundValue)
        return implicitInputNode()
      }
      let bound
      if (boundAst !== undefined) {
        // A bound expression that already evaluated to a node is used as it stands. Anything else is
        // resolved the way a mul/add/set param is (paramChain in draw/visualsynth/nodes.js): handed
        // to >> from a chain seed, so a bare call takes the pixel value and a plain value becomes an
        // animated uniform. The const wrap is kept rather than unwrapped, which is what makes
        // let{'wc',[]n^2} one uniform evaluated once a frame however many times `wc` is used.
        bound = isShaderNode(boundValue) ? boundValue : connectOp(implicitInputNode(), boundAst, ev, b, er)
        if (!isShaderNode(bound)) { bound = constShaderNode(boundAst, bound) }
      }
      bindLet(e, name, letRefShaderNode(name))
      return letShaderNode(name, bound)
    }

    // Audio: the identity gain that carries the chain through this point *is* the tap, so the name
    // resolves to a real node other parts of the chain can be fed from (panner{foo} connects it
    // straight to the AudioParam, play/eval-audio-params.js). Teardown needs nothing extra: connect()
    // registers the gain with the owning destructor as it is wired in.
    let node = vars.all().gain({value:1}, e,b)
    bindLet(e, name, boundValue !== undefined ? boundValue : node)
    return node
  }
  letNode.dontEvalArgs = true // The bound expression must reach us as a raw AST so we choose when to eval it
  addVarFunction('let', letNode)

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let {composeShaderNodes} = require('draw/visualsynth/shader-node')
  let {makeContext,buildSource} = require('draw/visualsynth/codegen')
  let {functionShaderNode} = require('draw/visualsynth/shader-function')
  let mockCtx = () => {
    let ctx = {statements: [], raw: [], uniforms: [], lets: {}, carried: {}, built: new Map()}
    ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
    ctx.addRaw = (stmt) => { ctx.raw.push(stmt) }
    ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
    return ctx
  }
  let mockNode = (tag) => makeShaderNode((input, ctx) => ctx.addStatement(`${tag}(${input})`))
  let audioNodeProto = Object.getPrototypeOf(Object.getPrototypeOf(require('play/system').audio.createGain()))
  let mockAn = () => {
    let an = Object.create(audioNodeProto)
    an.connect = () => {}
    an.disconnect = () => {}
    Object.defineProperty(an, "numberOfInputs", { get() { return 1 } })
    return an
  }
  let savedGain = vars.all().gain
  vars.all().gain = (args) => { let n = mockAn(); n.isMockGain = true; return n }
  vars.all().gain.isVarFunction = true
  let e, r, ctx

  // Audio, tap form: the gain that carries the chain is the tap, and the name is bound to it
  e = {}
  r = letNode({value:'foo'}, e, 0, {}, evalParamFrame)
  assert(true, r instanceof AudioNode)
  assert(true, e._lets.foo === r)

  // The name is lowercased, since a bare `foo` lookup already is
  e = {}
  letNode({value:'FoO'}, e, 0, {}, evalParamFrame)
  assert(true, e._lets.foo !== undefined)

  // Audio, two arg form: the name is bound to the given value and an identity gain still carries the chain
  e = {}
  let bound = mockAn()
  r = letNode({value:'foo', value1:bound}, e, 0, {}, evalParamFrame)
  assert(true, r instanceof AudioNode && r !== bound)
  assert(true, e._lets.foo === bound)

  // Audio, two arg form with a scalar
  e = {}
  letNode({value:'foo', value1:0.5}, e, 0, {}, evalParamFrame)
  assert(0.5, e._lets.foo)

  // Visual, tap form. >> pipes the chain value in, so the name shifts to value1
  e = {}
  r = letNode({value:passShaderNode(), value1:'foo'}, e, 0, {}, evalParamFrame)
  assert(true, isShaderNode(r))
  assert(true, isShaderNode(e._lets.foo))
  ctx = mockCtx()
  assert('v0', r.build('v0', ctx)) // Passes the chain value straight through
  assert([], ctx.statements) // and emits nothing, so the cache key is untouched
  assert('v0', ctx.lets.foo)
  assert('v0', e._lets.foo.build('v9', ctx)) // The name gives back what was recorded, whatever it is asked from

  // The name is taken as written off the raw AST, so it is still found when already bound (a loop{}
  // carry, or a let{} at the head of a loop{} body that the probe call has bound)
  let bareAst = (n) => { let f = () => 0; f.isVarLookup = true; f.hasOwnArgs = false; f._name = n; return f }
  e = {_lets: {foo: 'bound already'}}
  letNode({value: bareAst('foo'), value1: () => 0.25}, e, 0, {}, evalParamFrame)
  assert(0.25, e._lets.foo)

  // A quoted name still goes through the string path, and is still lowercased
  e = {}
  letNode({value: () => 'Foo', value1: () => 0.25}, e, 0, {}, evalParamFrame)
  assert(0.25, e._lets.foo)

  // A name used before it is set passes its input through rather than breaking the build
  ctx = mockCtx()
  assert('v3', letRefShaderNode('nothingbound').build('v3', ctx))

  // Visual, two arg form binding a node: the node is built at the let's position in the chain
  e = {}
  r = letNode({value:passShaderNode(), value1:'wc', value2:mockNode('tex')}, e, 0, {}, evalParamFrame)
  ctx = mockCtx()
  assert('v0', r.build('v0', ctx)) // The chain value still passes through untouched
  assert(['tex(v0)'], ctx.statements)
  assert('v1', ctx.lets.wc)

  // Visual, two arg form binding a scalar: one uniform, wrapped from the raw AST so it still animates
  e = {}
  let scalarAst = () => 0.25
  r = letNode({value:passShaderNode(), value1:'wc', value2:scalarAst}, e, 0, {}, evalParamFrame)
  ctx = mockCtx()
  r.build('v0', ctx)
  assert(['u_vs0'], ctx.statements)
  assert(true, ctx.uniforms[0] === scalarAst) // Raw AST, not the evaluated 0.25
  assert('v1', ctx.lets.wc)

  // An arg that is itself a visual node makes the call visual even when >> withheld the chain value
  e = {}
  r = letNode({value:'wc', value1:mockNode('tex')}, e, 0, {}, evalParamFrame)
  assert(true, isShaderNode(r))

  // End to end: cospal{wc,wc} shaped use emits the bound subtree once and reads one variable twice
  e = {}
  let def = letNode({value:passShaderNode(), value1:'wc', value2:mockNode('tex')}, e, 0, {}, evalParamFrame)
  let ref = e._lets.wc
  let use = makeShaderNode((input, c) => c.addStatement(`pal(${ref.build(input, c)}, ${ref.build(input, c)})`))
  let built = buildSource(composeShaderNodes(def, use))
  assert(1, (built.source.match(/tex\(v0\)/g) || []).length) // Emitted once
  assert(true, built.source.includes('pal(v1, v1)')) // and read twice from the one variable
  assert(true, built.source === buildSource(composeShaderNodes(def, use)).source) // byte-identical: cache key

  // Visual, binding a pxfn{}: the function itself is bound rather than the value it takes here, so
  // the name is the node and not a letRefShaderNode naming a variable
  e = {}
  let scenefn = functionShaderNode(mockNode('sdf'))
  r = letNode({value:'scene', value1:scenefn}, e, 0, {}, evalParamFrame)
  assert(true, e._lets.scene === scenefn)
  // and the let itself is transparent: it emits nothing and hands the chain seed straight back, so
  // >> treats the chain exactly as it would with the scene held in a var (connectOp's _implicitInput)
  assert(true, r._implicitInput === true)
  ctx = mockCtx()
  assert('v0', r.build('v0', ctx))
  assert([[], undefined], [ctx.statements, ctx.lets.scene])

  // End to end, the whole point: the bound name applied at two different points is one declaration
  // and a call at each. Binding the built value, as every other bound expression is, would give one
  // call at the let's own input and every use site reading that same variable — for a march, the
  // slice through the chain head.
  e = {}
  let marchfn = functionShaderNode(mockNode('sdf'))
  let scenedef = letNode({value:'scene', value1:marchfn}, e, 0, {}, evalParamFrame)
  let sceneref = e._lets.scene
  let twice = makeShaderNode((input, c) => c.addStatement(`lit(${sceneref.build(input, c)}, ${sceneref.build(c.addStatement(`step(${input})`), c)})`))
  let builtfn = buildSource(composeShaderNodes(scenedef, twice))
  assert(1, (builtfn.source.match(/vec4 l_fn0\(vec4 l_p0\)/g) || []).length) // one declaration
  assert(1, (builtfn.source.match(/sdf\(/g) || []).length) // the body written once, inside it
  assert(3, (builtfn.source.match(/l_fn0\(/g) || []).length) // the declaration and two calls
  assert(true, builtfn.source === buildSource(composeShaderNodes(scenedef, twice)).source) // byte-identical: cache key

  // ctx.lets is block scoped the way ctx.built is: an entry made inside a loop body names a variable
  // that has gone out of scope by the closing brace, so it must not survive it
  ctx = makeContext()
  ctx.lets.outer = 'v1'
  ctx.captureBlock(() => { ctx.lets.inner = 'v2'; assert('v1', ctx.lets.outer) })
  assert([true, false], [ctx.lets.outer === 'v1', ctx.lets.inner !== undefined])

  // Visual, a name declared in a loop{}'s carry:: the let assigns that variable in place rather than
  // naming a new one, so the value survives the iteration, and the name keeps pointing at it
  e = {}
  r = letNode({value:passShaderNode(), value1:'t', value2:mockNode('step')}, e, 0, {}, evalParamFrame)
  ctx = mockCtx()
  ctx.lets.t = 'v7'
  ctx.carried.t = 'v7'
  assert('v0', r.build('v0', ctx)) // The chain value still passes through
  assert([['step(v0)'], ['v7 = v1;']], [ctx.statements, ctx.raw])
  assert('v7', ctx.lets.t) // Still the carried variable, not the new one
  assert(true, ctx.volatile) // and nothing built across the assignment may be memoised

  // The tap form assigns the value flowing past
  ctx = mockCtx()
  ctx.lets.t = 'v7'
  ctx.carried.t = 'v7'
  letNode({value:passShaderNode(), value1:'t'}, {}, 0, {}, evalParamFrame).build('v3', ctx)
  assert([[], ['v7 = v3;']], [ctx.statements, ctx.raw])

  // Reading a carried name is volatile too: the variable holds something else after the next
  // assignment to it, so the read cannot be memoised either
  ctx = mockCtx()
  ctx.lets.t = 'v7'
  ctx.carried.t = 'v7'
  assert('v7', letRefShaderNode('t').build('v0', ctx))
  assert(true, ctx.volatile)

  // No name: warns and carries the chain on rather than breaking it
  e = {}
  assert(true, isShaderNode(letNode({value:passShaderNode()}, e, 0, {}, evalParamFrame)))
  assert(true, letNode({}, e, 0, {}, evalParamFrame) instanceof AudioNode)

  // During chord expansion nothing is built; a placeholder holds the slot
  let erExpand = (v,e,b) => evalParamFrame(v,e,b)
  erExpand.options = {expandingChords:true}
  assert(0, letNode({value:'foo'}, {}, 0, {}, erExpand))

  vars.all().gain = savedGain

  console.log('Let node tests complete')
  }

  return {
    letNode: letNode,
    bindLet: bindLet, // play/nodes/graph.js declares a loop{}'s carry: names with these
    letRefShaderNode: letRefShaderNode,
  }
})
