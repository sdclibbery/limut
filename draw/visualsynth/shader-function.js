'use strict'
define(function(require) {
  let consoleOut = require('console')
  let {makeShaderNode} = require('draw/visualsynth/shader-node')

  // pxfn{}: a px sub-chain compiled to a real GLSL function, declared once and called at each use.
  // Everything else inlines, and the (node, input) memo only dedupes the same input, so a scene sdf
  // used by a march, a normal, shadows and AO would otherwise be emitted many times.
  // Registration is in nodes.js; this file only emits.
  //
  // A function body sees its parameter, the seed (hoisted to file scope, codegen.js), uniforms,
  // samplers and its own declarations - nothing of the enclosing scope, since one declaration
  // serves callers with different environments. ctx.captureFunction enforces that.
  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  // Generated names that could refer to an enclosing scope: statement variables and loop counters
  // (tex{}'s uvN/arN match neither). A body referring to one it did not declare would be a GLSL
  // compile error; this turns it into a warning naming the variable. Reachable by reading an
  // enclosing loop{}'s index or fold accumulator from inside a body.
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
    let node = makeShaderNode((input, ctx) => {
      let name = ctx.pxFunctions !== undefined ? ctx.pxFunctions.get(key) : undefined
      if (name === undefined) {
        let f = ctx.functionName()
        let inner = ctx.captureFunction(() => body.build(f.param, ctx))
        checkScope(inner.statements, [f.param, ctx.rootInput])
        // Declared after the body is captured, so a pxfn nested inside this one — whose own
        // addFunction ran during the capture — is already declared above it, as GLSL requires.
        // shareBody: a declaration that already says this is used instead of a second copy of it,
        // which is what collapses one pxfn per repeat of a parallel{}/loop{} — each repeat resolves
        // a node of its own, so the (node, input) memo cannot see across them — into one. The name
        // that comes back is the one to call, this node's or the earlier one's.
        name = ctx.addFunction(f.name, `vec4 ${f.name}(vec4 ${f.param}) {\n  ${inner.statements.join('\n  ')}\n  return ${inner.out};\n}`, true)
        if (ctx.pxFunctions !== undefined) { ctx.pxFunctions.set(key, name) }
      }
      // The call is an ordinary statement, so the (node, input) memo applies to it as it does to
      // any other node: the same input twice is one call, a different input is another
      return ctx.addStatement(`${name}(${input})`)
    })
    // The one node that is a function of a point rather than a value at one. let{} checks this flag
    // to bind the node itself, so each use site builds its own call (see expression/let-node.js).
    node._isPxFunction = true
    return node
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

  // Marked as a function rather than a value: expression/let-node.js binds one of these unbuilt, so
  // an inline sdf3 scene is applied at every use site rather than named where the let is written
  assert(true, functionShaderNode(node('a'))._isPxFunction)

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

  // Two nodes with the same body are one declaration: identical bodies share (codegen.js's
  // shareBody), which is what a parallel{} of the same sub-chain comes down to — each repeat
  // resolves a node of its own, so the (node, input) memo cannot see across them
  ctx = makeContext()
  naryShaderNode((x,y) => `${x} + ${y}`, [{raw:undefined, value:composeShaderNodes(node('p'), functionShaderNode(node('a')))},
                                          {raw:undefined, value:composeShaderNodes(node('q'), functionShaderNode(node('a')))}]).build(ctx.rootInput, ctx)
  assert(1, ctx.functions.length)
  assert(['vec4 v1 = p(v0);', 'vec4 v3 = l_fn0(v1);', 'vec4 v4 = q(v0);', 'vec4 v6 = l_fn0(v4);', 'vec4 v7 = v3 + v6;'], ctx.statements)
  // Bodies that differ are still two declarations
  ctx = makeContext()
  naryShaderNode((x,y) => `${x} + ${y}`, [{raw:undefined, value:functionShaderNode(node('a'))},
                                          {raw:undefined, value:functionShaderNode(node('b'))}]).build(ctx.rootInput, ctx)
  assert(['l_fn0','l_fn1'], ctx.functions.map(x => x.name))

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
  // (the program cache key, and the hub75 layer key) is unaffected
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
