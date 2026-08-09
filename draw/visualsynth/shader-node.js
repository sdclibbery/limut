'use strict'
define(function(require) {
  let {getCallTree,setCallTree,clearCallTree} = require('player/callstack')

  // A shader node is a GLSL-emitting build step in a visual synth chain. Unlike audio nodes
  // (which eagerly construct a Web Audio graph), shader nodes are composed and only emit
  // code when the whole px chain is built into a single fragment shader.
  //
  // The call tree is snapshotted here, at creation, and put back for the build: a node created
  // inside a user defined function (set pixellate = {in,size} -> ...) registers uniforms whose
  // ASTs mention that function's args, and both the build and the per frame uniform eval happen
  // long after the call returned. Same trick as doPerFrame in play/eval-audio-params.js.
  let makeShaderNode = (build) => {
    let callTree = getCallTree()
    let buildInCallContext = (input, ctx) => {
      let outer = getCallTree()
      clearCallTree()
      setCallTree(callTree)
      try {
        return build(input, ctx)
      } finally {
        clearCallTree()
        setCallTree(outer)
      }
    }
    return { isShaderNode: true, build: buildInCallContext }
  }

  let isShaderNode = (v) => {
    return typeof v === 'object' && v !== null && v.isShaderNode === true
  }

  // a>>b: data flows left to right, so b consumes a's output
  let composeShaderNodes = (a, b) => {
    return makeShaderNode((input, ctx) => b.build(a.build(input, ctx), ctx))
  }

  // Passes its input straight through. Backs the id node, and is what >> hands to a call it pipes
  // a chain into, so the callee's result can be composed back onto the chain (see connectOp).
  let passthroughShaderNode = () => {
    return makeShaderNode((input, ctx) => ctx.addStatement(input))
  }

  // Wraps a non-node >> operand. Takes the raw unevaluated AST (mirroring connectOp's
  // gain{value:l} wrap) so the value becomes a per-frame animated uniform.
  let constShaderNode = (rawAst) => {
    return makeShaderNode((input, ctx) => ctx.addStatement(ctx.addUniform(rawAst)))
  }

  // A function of N operands, each {raw, value}, emitted as one statement: an operand that is
  // itself a node builds from the same input (they do not chain), and anything else becomes an
  // animated uniform wrapped from its raw AST (same discipline as constShaderNode). Operands
  // resolve left to right so generated names stay deterministic — the program cache key needs it.
  let buildOperands = (operands, input, ctx) => {
    return operands.map(o => isShaderNode(o.value) ? o.value.build(input, ctx) : ctx.addUniform(o.raw))
  }
  let naryShaderNode = (emit, operands) => {
    return makeShaderNode((input, ctx) => {
      return ctx.addStatement(emit(...buildOperands(operands, input, ctx)))
    })
  }

  // As naryShaderNode, but emit is also handed the incoming value, for a node whose dry side is
  // whatever flows down the chain: mix{wet,t} is mix(input, wet, t).
  let naryShaderNodeWithInput = (emit, operands) => {
    return makeShaderNode((input, ctx) => {
      return ctx.addStatement(emit(input, ...buildOperands(operands, input, ctx)))
    })
  }

  // A binary operator (+ - * / etc) over shader nodes: both sides see the same input, and their
  // outputs are combined in one emitted statement.
  let binaryShaderNode = (emit, l, el, r, er) => {
    return naryShaderNode(emit, [{raw:l, value:el}, {raw:r, value:er}])
  }

  // The names each of the 4 components answers to, in priority order: coordinates (xyzw), colours
  // (rgba) and texture coordinates (uv, and GLSL's own stpq). Note w is xyzw's 4th component, not
  // uvwq's 3rd — that one is p.
  let channelNames = [['x','r','u','s'], ['y','g','v','t'], ['z','b','p'], ['w','a','q']]

  // Unwrap units/timevar-segment wrappers, as an evaluated param may arrive inside several
  let unwrapValue = (v) => {
    while (typeof v === 'object' && v !== null && v.value !== undefined) { v = v.value }
    return v
  }

  // Convert an evaluated uniform value to vec4 components. Reuses a scratch array: callers
  // must consume the result (eg gl.uniform4fv) before the next call.
  let scratch = new Float32Array(4)
  let toVec4 = (v) => {
    v = unwrapValue(v)
    if (typeof v === 'number') {
      scratch[0] = v; scratch[1] = v; scratch[2] = v; scratch[3] = v
      return scratch
    }
    if (typeof v === 'object' && v !== null) {
      for (let i=0; i<4; i++) {
        let name = channelNames[i].find(n => v[n] !== undefined)
        scratch[i] = name !== undefined ? v[name] : (i === 3 ? 1 : 0) // Absent alpha defaults to 1, so a colour without one is opaque
      }
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

  // naryShaderNode: any number of operands, same rules, resolved left to right
  ctx = mockCtx()
  let three = (x,y,z) => `${x} ? ${y} : ${z}`
  let mAst = () => 3
  out = naryShaderNode(three, [{raw:undefined, value:a}, {raw:mAst, value:3}, {raw:undefined, value:b}]).build('v0', ctx)
  assert(['v0 * 2.0', 'v0 + 1.0', 'v1 ? u_vs0 : v2'], ctx.statements)
  assert(true, ctx.uniforms[0] === mAst)
  assert('v3', out)

  ctx = mockCtx()
  out = naryShaderNode(x => `-${x}`, [{raw:undefined, value:a}]).build('v0', ctx) // A single operand
  assert(['v0 * 2.0', '-v1'], ctx.statements)

  // naryShaderNodeWithInput: same operand rules, but emit also sees the incoming value
  ctx = mockCtx()
  out = naryShaderNodeWithInput((input,x,y) => `${input} + ${x} + ${y}`, [{raw:mAst, value:3}, {raw:undefined, value:a}]).build('v0', ctx)
  assert(['v0 * 2.0', 'v0 + u_vs0 + v1'], ctx.statements) // operands still see the same input
  assert(true, ctx.uniforms[0] === mAst)
  assert('v2', out)

  // A node created inside a user defined function's call context gets that context back for its
  // build, so an arg lookup in a uniform AST (eg `size` in set pixellate = {in,size} -> ...)
  // still resolves once the call has returned
  let {pushCallContext,popCallContext,getCallContext} = require('player/callstack')
  let seenDuringBuild
  pushCallContext({size:20})
  let inLambda = makeShaderNode((input, c) => { seenDuringBuild = getCallContext(); return c.addStatement(input) })
  popCallContext()
  assert(undefined, getCallContext()) // Out of the call now
  ctx = mockCtx()
  inLambda.build('v0', ctx)
  assert({size:20}, seenDuringBuild)
  assert(undefined, getCallContext()) // And the outer tree is put back afterwards

  assert([2,2,2,2], Array.from(toVec4(2))) // number splats all channels
  assert([1,2,3,4], Array.from(toVec4({x:1,y:2,z:3,w:4})))
  assert([1,2,3,1], Array.from(toVec4({r:1,g:2,b:3}))) // alpha defaults 1
  assert([0,5,0,1], Array.from(toVec4({y:5})))
  assert([1,2,3,4], Array.from(toVec4({u:1,v:2,p:3,q:4}))) // texture coordinate names
  assert([1,2,3,4], Array.from(toVec4({s:1,t:2,p:3,q:4}))) // and GLSL's own stpq spelling
  assert([0,0,0,9], Array.from(toVec4({w:9}))) // w is the 4th component, not uvwq's 3rd
  assert([1,0,0,1], Array.from(toVec4({x:1,u:5}))) // xyzw wins over the aliases
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
    passthroughShaderNode: passthroughShaderNode,
    constShaderNode: constShaderNode,
    binaryShaderNode: binaryShaderNode,
    naryShaderNode: naryShaderNode,
    naryShaderNodeWithInput: naryShaderNodeWithInput,
    toVec4: toVec4,
    channelNames: channelNames,
    unwrapValue: unwrapValue,
  }
})
