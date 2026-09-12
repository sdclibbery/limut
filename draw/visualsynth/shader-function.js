'use strict'
define(function(require) {
  let consoleOut = require('console')
  let {makeShaderNode} = require('draw/visualsynth/shader-node')

  // pxfn{} : a px sub-chain compiled to a real GLSL function, declared once however many times the
  // value is used, rather than written into the shader again at every use site.
  //
  // Everything else in the system inlines. A shader node's build appends its statements to main()
  // and hands back a variable, and the (node, input) memo in shader-node.js only dedupes a node
  // reached again on the *same* input — so a sub-chain used at N different inputs is emitted N
  // times. That is what a chain stage wants, but not a scene sdf: once per march step (rolled, so
  // emitted once), then four more for a tetrahedral normal, plus shadows and AO. ctx.addFunction
  // was already there for the helper declarations (the pxhash hashes, the colour conversions), so
  // this is the same seam with the body captured out of the chain rather than written by hand.
  //
  // The registration half is in draw/visualsynth/nodes.js; this file only emits, the same split
  // shader-repeat.js has with play/nodes/graph.js.
  //
  // A function body is a scope of its own: it sees its parameter, the seed (which is why declaring
  // one hoists v0 to file scope, see codegen.js), the uniforms, the samplers and whatever it
  // declares itself — and nothing of the enclosing scope, because the declaration is made once with
  // fixed parameters and the same sub-chain called from two places with two different environments
  // could not then share it. ctx.captureFunction is what enforces that.
  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  // The two generated name shapes that could name something from an enclosing scope: a statement
  // variable and a loop counter. (uvN/arN, the locals tex{} emits, match neither — the v is not at
  // a word boundary — and are always emitted beside their use anyway.) Anything a body refers to
  // that it did not declare, and that is not its own parameter or the file scope seed, would be a
  // GLSL compile error with a source dump as the only clue; this turns it into one warning naming
  // the variable. Reachable today by reading an enclosing loop{}'s index or its fold accumulator
  // from inside a body.
  let declaredIn = (statements) => {
    let names = {}
    statements.forEach(st => {
      let m
      let decl = /\bvec4 (v\d+) *=/g
      while ((m = decl.exec(st)) !== null) { names[m[1]] = true }
      let loop = /\bfor *\(int (l_i\d+)/g
      while ((m = loop.exec(st)) !== null) { names[m[1]] = true }
    })
    return names
  }
  let checkScope = (statements, allowed) => {
    let declared = declaredIn(statements)
    statements.forEach(st => {
      let m
      let ref = /\bv\d+\b|\bl_i\d+\b/g
      while ((m = ref.exec(st)) !== null) {
        if (declared[m[0]] || allowed.includes(m[0])) { continue }
        warnOnce(`🟠 pxfn{} body refers to ${m[0]} from outside the function`)
      }
    })
  }

  let functionShaderNode = (body) => {
    let key = {} // Identity for the per context declaration registry: one declaration per pxfn per shader
    return makeShaderNode((input, ctx) => {
      let name = ctx.pxFunctions !== undefined ? ctx.pxFunctions.get(key) : undefined
      if (name === undefined) {
        let f = ctx.functionName()
        let inner = ctx.captureFunction(() => body.build(f.param, ctx))
        checkScope(inner.statements, [f.param, ctx.rootInput])
        // Declared after the body is captured, so a pxfn nested inside this one — whose own
        // addFunction ran during the capture — is already declared above it, as GLSL requires
        ctx.addFunction(f.name, `vec4 ${f.name}(vec4 ${f.param}) {\n  ${inner.statements.join('\n  ')}\n  return ${inner.out};\n}`)
        name = f.name
        if (ctx.pxFunctions !== undefined) { ctx.pxFunctions.set(key, name) }
      }
      // The call is an ordinary statement, so the (node, input) memo applies to it as it does to
      // any other node: the same input twice is one call, a different input is another
      return ctx.addStatement(`${name}(${input})`)
    })
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let {composeShaderNodes,naryShaderNode,passthroughShaderNode} = require('draw/visualsynth/shader-node')
  let {makeContext,buildSource} = require('draw/visualsynth/codegen')
  let {loopShaderNode} = require('draw/visualsynth/shader-repeat')
  let node = (tag) => makeShaderNode((input, ctx) => ctx.addStatement(`${tag}(${input})`))
  let uniformNode = (ast) => makeShaderNode((input, ctx) => ctx.addStatement(`${input} * ${ctx.addUniform(ast)}`))
  let uvNode = () => makeShaderNode((input, ctx) => ctx.addStatement(`${input} + ${ctx.rootInput}`))

  // The body goes into a declaration rather than into the chain, and the chain gets a call. The
  // body is captured before the call is emitted, so its variables take the lower numbers.
  let ctx = makeContext()
  let f = functionShaderNode(node('a'))
  let out = f.build(ctx.rootInput, ctx)
  assert(['vec4 v2 = l_fn0(v0);'], ctx.statements)
  assert('v2', out)
  assert(['l_fn0'], ctx.functions.map(x => x.name))
  assert('vec4 l_fn0(vec4 l_p0) {\n  vec4 v1 = a(l_p0);\n  return v1;\n}', ctx.functions[0].source)

  // Called at several different inputs: one declaration, one call each. This is the whole point.
  ctx = makeContext()
  f = functionShaderNode(node('a'))
  naryShaderNode((x,y) => `${x} + ${y}`, [{raw:undefined, value:composeShaderNodes(node('p'), f)},
                                          {raw:undefined, value:composeShaderNodes(node('q'), f)}]).build(ctx.rootInput, ctx)
  assert(['vec4 v1 = p(v0);', 'vec4 v3 = l_fn0(v1);', 'vec4 v4 = q(v0);', 'vec4 v5 = l_fn0(v4);', 'vec4 v6 = v3 + v5;'], ctx.statements)
  assert(1, ctx.functions.length)
  assert(1, (ctx.functions[0].source.match(/a\(l_p0\)/g) || []).length) // The body itself written once

  // The same input twice is one call: the ordinary (node, input) memo, as for any other node
  ctx = makeContext()
  f = functionShaderNode(node('a'))
  naryShaderNode((x,y) => `${x} + ${y}`, [{raw:undefined, value:f}, {raw:undefined, value:f}]).build(ctx.rootInput, ctx)
  assert(['vec4 v2 = l_fn0(v0);', 'vec4 v3 = v2 + v2;'], ctx.statements)

  // The body's uniforms are registered once however many call sites there are: uniforms are the
  // scarce resource in a generated shader, so this is most of what the feature buys
  ctx = makeContext()
  let uAst = () => 2
  f = functionShaderNode(uniformNode(uAst))
  f.build(ctx.rootInput, ctx)
  f.build('v9', ctx)
  assert(1, ctx.uniforms.length)
  assert(2, ctx.statements.length) // But called twice

  // An identity body hands its parameter straight back
  ctx = makeContext()
  functionShaderNode(passthroughShaderNode()).build(ctx.rootInput, ctx)
  assert('vec4 l_fn0(vec4 l_p0) {\n  vec4 v1 = l_p0;\n  return v1;\n}', ctx.functions[0].source)
  ctx = makeContext()
  functionShaderNode(makeShaderNode((input) => input)).build(ctx.rootInput, ctx) // A body emitting nothing at all
  assert('vec4 l_fn0(vec4 l_p0) {\n  \n  return l_p0;\n}', ctx.functions[0].source)

  // Nested: the inner function is declared above the outer one, as GLSL requires, because the
  // declaration is added after the body it belongs to has been captured
  ctx = makeContext()
  let innerFn = functionShaderNode(node('a'))
  functionShaderNode(composeShaderNodes(node('b'), innerFn)).build(ctx.rootInput, ctx)
  assert(['l_fn1', 'l_fn0'], ctx.functions.map(x => x.name)) // Declared inner first, named outer first
  assert('vec4 l_fn0(vec4 l_p0) {\n  vec4 v1 = b(l_p0);\n  vec4 v3 = l_fn1(v1);\n  return v3;\n}', ctx.functions[1].source)
  assert('vec4 l_fn1(vec4 l_p1) {\n  vec4 v2 = a(l_p1);\n  return v2;\n}', ctx.functions[0].source)

  // Names come from counters, per context, like every other generated name
  let nctx = makeContext()
  assert([{name:'l_fn0',param:'l_p0'},{name:'l_fn1',param:'l_p1'}], [nctx.functionName(), nctx.functionName()])
  assert({name:'l_fn0',param:'l_p0'}, makeContext().functionName())

  // A body cannot see the enclosing scope: a node already built outside it emits again rather than
  // naming one of main's variables, and a let bound outside it is not visible
  ctx = makeContext()
  let shared = node('a')
  shared.build(ctx.rootInput, ctx)
  ctx.lets['d'] = 'v1'
  let readsLet = makeShaderNode((input, c) => c.addStatement(`c(${c.lets['d'] !== undefined ? c.lets['d'] : 'nothing'})`))
  functionShaderNode(composeShaderNodes(makeShaderNode((i,c) => shared.build('v0', c)), readsLet)).build('v1', ctx)
  assert(true, ctx.functions[0].source.includes('vec4 v2 = a(v0);')) // Emitted again inside
  assert(true, ctx.functions[0].source.includes('c(nothing)')) // The outer let is not in scope
  assert('v1', ctx.lets['d']) // and the outer binding is left as it was

  // A let bound inside a body is local to it: gone once the declaration is closed
  ctx = makeContext()
  let binds = makeShaderNode((input, c) => { c.lets['d'] = c.addStatement(`a(${input})`); return c.lets['d'] })
  functionShaderNode(binds).build(ctx.rootInput, ctx)
  assert(undefined, ctx.lets['d'])

  // A pxfn first built inside a loop body declares at file scope — a declaration is not block
  // scoped, any more than a uniform slot is — while its call stays inside the block
  ctx = makeContext()
  f = functionShaderNode(node('a'))
  composeShaderNodes(loopShaderNode(f, 2), f).build(ctx.rootInput, ctx)
  assert([
    'vec4 v1 = v0;',
    'for (int l_i0 = 0; l_i0 < 2; l_i0++) {',
    '  vec4 v3 = l_fn0(v1);',
    '  v1 = v3;',
    '}',
    'vec4 v4 = l_fn0(v1);'], ctx.statements)
  assert(1, ctx.functions.length) // One declaration, called from inside the loop and after it

  // A loop written inside a body: the block lands in the declaration, counter and all
  ctx = makeContext()
  functionShaderNode(loopShaderNode(node('a'), 2)).build(ctx.rootInput, ctx)
  assert(true, ctx.functions[0].source.includes('for (int l_i0 = 0; l_i0 < 2; l_i0++) {'))
  assert(['vec4 v3 = l_fn0(v0);'], ctx.statements)

  // uv reaches into a body: hoisting the seed to file scope is what that is for
  let built = buildSource(functionShaderNode(uvNode()))
  assert(true, built.source.includes('vec4 v0;\nvec4 l_fn0(vec4 l_p0) {')) // Declared before the functions
  assert(true, built.source.includes('void main() {\n  v0 = vec4(fragCoord, 0.0, 1.0);')) // and assigned, not redeclared
  assert(true, built.source.includes('vec4 v1 = l_p0 + v0;'))
  assert(1, (built.source.match(/vec4 v0/g) || []).length)

  // A shader with no function in it is untouched: the seed stays a local of main, so the source
  // (the program cache key, and the hub75 layer key) is byte-identical to what it always was
  let plain = buildSource(node('a'))
  assert(true, plain.source.includes('void main() {\n  vec4 v0 = vec4(fragCoord, 0.0, 1.0);'))
  assert(false, plain.source.includes('vec4 v0;'))

  // Byte-identical source on a rebuild: the program cache key property
  let rebuildable = composeShaderNodes(functionShaderNode(uniformNode(uAst)), node('b'))
  assert(true, buildSource(rebuildable).source === buildSource(rebuildable).source)

  // The whole shader, shaped like px=p>>pxfn{a}
  built = buildSource(composeShaderNodes(node('p'), functionShaderNode(node('a'))))
  assert(true, built.source.indexOf('vec4 l_fn0(vec4 l_p0)') < built.source.indexOf('void main()')) // Declared before it is called
  assert(true, built.source.includes('vec4 v1 = p(v0);\n  vec4 v3 = l_fn0(v1);'))
  assert(true, built.source.includes('fragColor = v3;'))

  // The scope guard: a body naming a variable it did not declare warns, rather than leaving an
  // opaque GLSL compile error. Reachable by reading an enclosing loop's index from inside a body.
  let savedWarned = warned
  warned = {}
  checkScope(['vec4 v2 = a(l_p0);', 'vec4 v3 = b(v2);'], ['l_p0', 'v0']) // Nothing from outside: silent
  assert([], Object.keys(warned))
  checkScope(['vec4 v2 = a(v0);'], ['l_p0', 'v0']) // The seed is at file scope: allowed
  assert([], Object.keys(warned))
  checkScope(['vec4 v2 = vec4(float(l_i0));'], ['l_p0', 'v0']) // An enclosing loop's counter is not
  assert(['🟠 pxfn{} body refers to l_i0 from outside the function'], Object.keys(warned))
  warned = {}
  checkScope(['vec4 v2 = a(v7);'], ['l_p0', 'v0'])
  assert(['🟠 pxfn{} body refers to v7 from outside the function'], Object.keys(warned))
  warned = {}
  // A loop written inside the body declares its own counter, so that is not a leak
  checkScope(['for (int l_i0 = 0; l_i0 < 2; l_i0++) {', '  vec4 v2 = a(l_p0);', '  vec4 v3 = vec4(float(l_i0));', '}'], ['l_p0', 'v0'])
  assert([], Object.keys(warned))
  // Neither are the uniforms, the samplers, the tex{} locals or a nested function's name
  checkScope(['vec2 uv0 = (l_p0).xy;', 'float ar0 = u_vsex0.y > 0.0 ? u_vsex0.x / u_vsex0.y : 1.0;',
              'vec4 v2 = texture(u_vstex0, fract(uv0));', 'vec4 v3 = l_fn1(v2) * u_vs0;'], ['l_p0', 'v0'])
  assert([], Object.keys(warned))
  warned = savedWarned

  console.log('Shader function tests complete')
  }

  return {
    functionShaderNode: functionShaderNode,
  }
})
