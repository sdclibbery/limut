'use strict'
define(function(require) {
  let {isShaderNode,naryShaderNode,naryShaderNodeWithInput} = require('draw/visualsynth/shader-node')
  let {evalParamEvent} = require('player/eval-param')

  // The visual half of mix{} (play/nodes/graph.js): given a visual node it compiles to GLSL mix()
  // instead of wiring dry/wet audio gains, the same dispatch-on-the-value rule the arithmetic
  // operators (expression/shaderNodeOps.js) and maths functions (shader-maths.js) use.
  //
  //   mix{a,b,t}   ->  mix(a, b, t)          explicit, so it works inside a user defined function
  //   mix{wet,t}   ->  mix(input, wet, t)    dry is whatever flows down the chain, as for audio
  //   mix{wet}     ->  mix(input, wet, 0.5)  same default mix as the audio node
  //
  // mix is a node function, so >> composes it rather than piping into it and its input really is
  // the chain value at that point. Inside a user defined function it works too, because a piped
  // call is composed onto the chain rather than restarted from the raw coordinate (see the pipe
  // branch of expression/connectOp.js): set monochrome = {in,v:1} -> mix{dot{in,#3b1},v}
  //
  // Operands carry their raw unevalled AST alongside the evalled value, so a non-node operand
  // becomes a uniform re-evalled every frame rather than a constant frozen at event time.

  let mixShaderNode = (params, evalledValue, e) => {
    // Only take the visual path when a node is really there. The main arg is already evalled by the
    // caller; the others are left alone until we know this is not audio, since evalling an audio
    // chain eagerly would construct nodes. A third positional is proof enough on its own: the audio
    // mix never reads one, so its presence means this cannot be an audio call, and the node may be
    // in any of the args (eg a texture as the mask in mix{#f00,#00f,tex{}}).
    if (!isShaderNode(evalledValue) && params.value2 === undefined) { return undefined }
    let operand = (raw) => ({ raw: raw, value: evalParamEvent(raw, e) })
    let ops = [{ raw: params.value, value: evalledValue }]
    if (params.value1 !== undefined) { ops.push(operand(params.value1)) }
    if (params.value2 !== undefined) { ops.push(operand(params.value2)) }
    if (!ops.some(o => isShaderNode(o.value))) { return undefined } // Three plain values: still audio
    // t is the named mix arg, else the last positional; whatever is left over is a and b
    let t
    if (params.mix !== undefined) { t = operand(params.mix) }
    else if (ops.length > 1) { t = ops.pop() }
    else { t = { raw: 1/2, value: 1/2 } }
    if (ops.length > 1) {
      return naryShaderNode((a,b,tn) => `mix(${a}, ${b}, ${tn})`, [ops[0], ops[1], t])
    }
    return naryShaderNodeWithInput((input,b,tn) => `mix(${input}, ${b}, ${tn})`, [ops[0], t])
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
  let node = (tag) => ({isShaderNode:true, build: (input, ctx) => ctx.addStatement(`${tag}(${input})`)})
  let emitted = (params) => { // Apply mix to params, return the generated statement
    let n = mixShaderNode(params, params.value, {})
    let ctx = mockCtx()
    n.build('v0', ctx)
    return ctx.statements[ctx.statements.length-1]
  }

  // Three positional args are a straight GLSL mix
  assert('mix(v1, v2, u_vs0)', emitted({value:node('a'), value1:node('b'), value2:1/2}))
  // Two args take the dry side from the incoming value
  assert('mix(v0, v1, u_vs0)', emitted({value:node('b'), value1:1/2}))
  // One arg defaults the mix to 1/2
  assert('mix(v0, v1, u_vs0)', emitted({value:node('b')}))
  let ctx = mockCtx()
  mixShaderNode({value:node('b')}, node('b'), {}).build('v0', ctx)
  assert([1/2], ctx.uniforms)
  // The named mix arg is the t, so both positionals stay as a and b
  assert('mix(v1, v2, u_vs0)', emitted({value:node('a'), value1:node('b'), mix:1/4}))
  assert('mix(v0, v1, u_vs0)', emitted({value:node('b'), mix:1/4}))
  // Any operand may be a node, including the t: a per pixel mask
  assert('mix(v1, v2, v3)', emitted({value:node('a'), value1:node('b'), value2:node('t')}))

  // Operands see the same input; they do not chain
  ctx = mockCtx()
  mixShaderNode({value:node('a'), value1:node('b'), value2:1/2}, node('a'), {}).build('v0', ctx)
  assert(['a(v0)', 'b(v0)', 'mix(v1, v2, u_vs0)'], ctx.statements)

  // A non-node operand registers its raw AST, so it stays animated
  let rawAst = () => 1/2
  ctx = mockCtx()
  mixShaderNode({value:node('b'), value1:rawAst}, node('b'), {}).build('v0', ctx)
  assert(true, ctx.uniforms[0] === rawAst)

  // No node anywhere means this is an audio mix: fall through
  assert(undefined, mixShaderNode({value:1/2}, 1/2, {}))
  assert(undefined, mixShaderNode({value:1/2, value1:1/4}, 1/2, {}))
  assert(undefined, mixShaderNode({}, undefined, {}))
  // A third positional is checked further, since the audio mix never takes one: the node can be
  // in any of the args, eg a texture used as the mask in mix{#f00,#00f,tex{}}
  assert(true, mixShaderNode({value:1/2, value1:node('b'), value2:1/4}, 1/2, {}).isShaderNode)
  assert(true, mixShaderNode({value:1/2, value1:1/4, value2:node('t')}, 1/2, {}).isShaderNode)
  assert('mix(u_vs0, u_vs1, v1)', emitted({value:1/2, value1:1/4, value2:node('t')}))
  assert(undefined, mixShaderNode({value:1/2, value1:1/4, value2:1/8}, 1/2, {}))

  console.log('Shader mix tests complete')
  }

  return {
    mixShaderNode: mixShaderNode,
  }
})
