'use strict'
define(function(require) {

  // A shader node is a GLSL-emitting build step in a visual synth chain. Unlike audio nodes
  // (which eagerly construct a Web Audio graph), shader nodes are composed and only emit
  // code when the whole px chain is built into a single fragment shader.
  let makeShaderNode = (build) => {
    return { isShaderNode: true, build: build }
  }

  let isShaderNode = (v) => {
    return typeof v === 'object' && v !== null && v.isShaderNode === true
  }

  // a>>b: data flows left to right, so b consumes a's output
  let composeShaderNodes = (a, b) => {
    return makeShaderNode((input, ctx) => b.build(a.build(input, ctx), ctx))
  }

  // Wraps a non-node >> operand. Takes the raw unevaluated AST (mirroring connectOp's
  // gain{value:l} wrap) so the value becomes a per-frame animated uniform.
  let constShaderNode = (rawAst) => {
    return makeShaderNode((input, ctx) => ctx.addStatement(ctx.addUniform(rawAst)))
  }

  // A binary operator (+ - * / etc) over shader nodes: both sides see the same input, and their
  // outputs are combined in one emitted statement. A non-node side becomes an animated uniform
  // wrapped from its raw AST (same discipline as constShaderNode). Left is always resolved before
  // right, so generated names stay deterministic — the program cache key depends on it.
  let binaryShaderNode = (emit, l, el, r, er) => {
    return makeShaderNode((input, ctx) => {
      let a = isShaderNode(el) ? el.build(input, ctx) : ctx.addUniform(l)
      let b = isShaderNode(er) ? er.build(input, ctx) : ctx.addUniform(r)
      return ctx.addStatement(emit(a, b))
    })
  }

  // Convert an evaluated uniform value to vec4 components. Reuses a scratch array: callers
  // must consume the result (eg gl.uniform4fv) before the next call.
  let scratch = new Float32Array(4)
  let toVec4 = (v) => {
    while (typeof v === 'object' && v !== null && v.value !== undefined) { v = v.value } // Unwrap units/timevar-segment wrappers
    if (typeof v === 'number') {
      scratch[0] = v; scratch[1] = v; scratch[2] = v; scratch[3] = v
      return scratch
    }
    if (typeof v === 'object' && v !== null) {
      scratch[0] = v.x !== undefined ? v.x : (v.r !== undefined ? v.r : 0)
      scratch[1] = v.y !== undefined ? v.y : (v.g !== undefined ? v.g : 0)
      scratch[2] = v.z !== undefined ? v.z : (v.b !== undefined ? v.b : 0)
      scratch[3] = v.w !== undefined ? v.w : (v.a !== undefined ? v.a : 1)
      return scratch
    }
    scratch[0] = 1; scratch[1] = 1; scratch[2] = 1; scratch[3] = 1
    return scratch
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let mockCtx = () => {
    let ctx = { statements: [], uniforms: [] }
    ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
    ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
    return ctx
  }

  assert(false, isShaderNode(undefined))
  assert(false, isShaderNode(0))
  assert(false, isShaderNode('x'))
  assert(false, isShaderNode({}))
  assert(true, isShaderNode(makeShaderNode(() => {})))

  let ctx = mockCtx()
  let a = makeShaderNode((input, c) => c.addStatement(input + ' * 2.0'))
  let b = makeShaderNode((input, c) => c.addStatement(input + ' + 1.0'))
  let out = composeShaderNodes(a, b).build('v0', ctx)
  assert(['v0 * 2.0', 'v1 + 1.0'], ctx.statements) // left node emits first, right consumes its output
  assert('v2', out)

  ctx = mockCtx()
  let ast = () => 0.5
  out = constShaderNode(ast).build('v0', ctx)
  assert('v1', out)
  assert(['u_vs0'], ctx.statements) // input ignored, output is just the uniform
  assert(true, ctx.uniforms[0] === ast) // raw AST registered, not evaluated

  // binaryShaderNode: both sides build from the same input, combined in one statement
  let add = (x,y) => `${x} + ${y}`
  ctx = mockCtx()
  out = binaryShaderNode(add, undefined, a, undefined, b).build('v0', ctx)
  assert(['v0 * 2.0', 'v0 + 1.0', 'v1 + v2'], ctx.statements) // node/node: both see v0, no chaining
  assert('v3', out)

  ctx = mockCtx()
  let lAst = () => 2
  out = binaryShaderNode(add, lAst, 2, undefined, a).build('v0', ctx)
  assert(['v0 * 2.0', 'u_vs0 + v1'], ctx.statements) // scalar on the left keeps operand order
  assert(true, ctx.uniforms[0] === lAst) // raw AST registered, not the evaluated 2

  ctx = mockCtx()
  let rAst = () => 2
  out = binaryShaderNode(add, undefined, a, rAst, 2).build('v0', ctx)
  assert(['v0 * 2.0', 'v1 + u_vs0'], ctx.statements) // scalar on the right
  assert(true, ctx.uniforms[0] === rAst)

  assert([2,2,2,2], Array.from(toVec4(2))) // number splats all channels
  assert([1,2,3,4], Array.from(toVec4({x:1,y:2,z:3,w:4})))
  assert([1,2,3,1], Array.from(toVec4({r:1,g:2,b:3}))) // alpha defaults 1
  assert([0,5,0,1], Array.from(toVec4({y:5})))
  assert([3,3,3,3], Array.from(toVec4({value:3, _nextSegment:1}))) // timevar segment wrapper unwraps
  assert([7,7,7,7], Array.from(toVec4({value:{value:7}}))) // nested wrappers unwrap
  assert([1,1,1,1], Array.from(toVec4('nonsense'))) // fallback is neutral
  assert([1,1,1,1], Array.from(toVec4(undefined)))

  console.log('Shader node tests complete')
  }

  return {
    makeShaderNode: makeShaderNode,
    isShaderNode: isShaderNode,
    composeShaderNodes: composeShaderNodes,
    constShaderNode: constShaderNode,
    binaryShaderNode: binaryShaderNode,
    toVec4: toVec4,
  }
})
