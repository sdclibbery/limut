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
  // Bindings hang off the event rather than a scope stack of their own, because the event is the
  // object whose lifetime already matches a chain's: a visual chain's uniforms are re-evaluated
  // against it every frame, and a persistent fx chain (play/player-fx.js) reads its params for the
  // whole life of the chain, long after it was built. Scope is therefore the whole event: a `let`
  // is visible anywhere later in that event's params, including inside a user defined function the
  // chain calls. The read side is in parse-var.js.

  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  // A lookup's args double as its time modifiers, so evalFunctionWithModifiers has already evalled
  // every arg once, un-piped, and memoised that on the event. Resolving the bound expression as a
  // chain of its own must not see those entries, or >> gets that earlier value handed back instead
  // of building the chain. Same protocol as paramChain in draw/visualsynth/nodes.js.
  //
  // The isolation is an event of its own, not {doNotMemoise:true}: doNotMemoise propagates the
  // whole way down, so every repeated reference inside a user defined function re-evaluates its
  // subtree and yields a *fresh* node object, which ctx.built cannot dedupe by identity, and the
  // built chain multiplies with the number of repeated references. `let{'a', f{id*2}}` for an f
  // naming its argument four times built four times the chain that a bare `f{id*2}` does.
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

  // The name is written as a quoted string ('foo') or as a bare word. >> shifts positional args up
  // when it pipes, so the name sits in `value` when the call was not piped and in `value1` when it
  // was: find it by looking at the positional args in turn rather than by counting. Whatever comes
  // after it is the expression being bound.
  //
  // A bare word is taken as *written*, off the raw AST (let has dontEvalArgs, so these are the
  // unevalled parse instances) — the same discipline the `global.` lookup and shaderSwizzle use.
  // Evaluating it instead, which is what this did, only works while the name is unbound: a bound
  // name evaluates to its own binding (parse-var.js looks _lets up ahead of everything), never to a
  // string, so it came back as `🟠 let needs a name`. A loop{} carried value is bound on purpose, so
  // `let{t, t+d}` would hit that every time; the same reading also settles a name the probe call in
  // play/nodes/graph.js's loop{} has already bound. The one thing it gives up is `let{nm}` for an nm
  // holding a string, which named what nm said and now names nm - say `let{'foo'}` for that.
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

  // The definition node, returned into the chain so >> composes it on: its build sees the value
  // flowing down the chain at this point and records the GLSL variable holding it. The tap form
  // emits no statement of its own, so a chain with a let in it generates byte-identical source to
  // the same chain without one — the program cache is keyed on that source.
  //
  // A name declared in a loop{}'s carry: already *has* a variable, one declared outside the loop
  // (shader-repeat.js), so this assigns it in place instead of naming a new one. That is the whole
  // of the carried value: the assignment survives the iteration, and since ctx.lets keeps pointing
  // at the same variable every read of the name — inside the body, in until:, and after the loop —
  // names it. Both the assignment and every read of the name set ctx.volatile, which is what keeps
  // the build memo (ctx.built) from handing back a variable worked out before the assignment - see
  // makeShaderNode in draw/visualsynth/shader-node.js.
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

    // Which domain the chain is in, decided without asking connectOp. In a visual chain `let` is
    // always piped — the left hand side is a shader node, so it is never connectable and >> takes
    // the pipe branch, including at the head of a px param, which player/params.js writes as
    // `id>>...`. The one exception is a call already holding a visual node of its own, which >>
    // withholds the seed from (hasShaderNodeArg), and that is exactly the case where the bound
    // expression is itself visual. In an audio chain `let` is never piped: a connectable left hand
    // side keeps the wire, and at the head of an fx chain there is no left hand side at all.
    let visual = isShaderNode(pipedValue) || isShaderNode(boundValue)

    if (visual) {
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

  // The name is taken as written off the raw AST, so it is still found when that name is already
  // bound. Evaluating it, which is what this used to do, gives back the binding rather than a
  // string: that is what a loop{} carried value needs (let{t, t+d} names a t bound on purpose) and
  // what used to lose the name of a let{} at the head of a loop{} body, where the probe call has
  // already bound it
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
