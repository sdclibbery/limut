'use strict';
define(function(require) {
  let {binaryShaderNode} = require('draw/visualsynth/shader-node')

  // Operators applied to visual synth nodes compile into GLSL instead of being evaluated.
  // The audio analogue is expression/connectableOps.js, but unlike audio these must preserve
  // operand order: `2-id` and `id-2` are different shaders.
  let shaderNodeOp = (emit) => {
    let op = (l, el, r, er) => {
      if (l === undefined) { return er } // Mirrors connectOp: a missing side is a no-op
      if (r === undefined) { return el }
      return binaryShaderNode(emit, l, el, r, er)
    }
    return op
  }

  // Per-channel 1.0/0.0, matching limut comparisons returning 1 or 0
  let compare = (glslFn) => shaderNodeOp((a,b) => `vec4(${glslFn}(${a}, ${b}))`)

  let shaderNodeOps = {
    '+': shaderNodeOp((a,b) => `${a} + ${b}`),
    '-': shaderNodeOp((a,b) => `${a} - ${b}`),
    '*': shaderNodeOp((a,b) => `${a} * ${b}`),
    // Divide by zero is left to GLSL (inf/NaN) rather than clamped like the JS path in
    // operators.js: guarding every divide isn't worth the per-pixel cost.
    '/': shaderNodeOp((a,b) => `${a} / ${b}`),
    // GLSL mod is floored (sign of divisor) where JS % is truncated; they agree for positives
    '%': shaderNodeOp((a,b) => `mod(${a}, ${b})`),
    // pow is undefined in GLSL for a negative base. Clamping to 0 matches the JS operator,
    // which already yields 0 for eg (-1)^0.5 via defaultUndefined's non-finite clamp.
    '^': shaderNodeOp((a,b) => `pow(max(${a}, vec4(0.0)), ${b})`),

    '==': compare('equal'),
    '!=': compare('notEqual'),
    '<=': compare('lessThanEqual'),
    '>=': compare('greaterThanEqual'),
    '<': compare('lessThan'),
    '>': compare('greaterThan'),
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
  let node = {isShaderNode:true, build: (input, ctx) => input}
  let emitted = (k) => { // Apply op to <node> and a raw scalar AST, return the generated statement
    let ctx = mockCtx()
    shaderNodeOps[k]('lhsAst', node, 'rhsAst', 2).build('v0', ctx)
    return ctx.statements[0]
  }

  assert('v0 + u_vs0', emitted('+'))
  assert('v0 - u_vs0', emitted('-'))
  assert('v0 * u_vs0', emitted('*'))
  assert('v0 / u_vs0', emitted('/'))
  assert('mod(v0, u_vs0)', emitted('%'))
  assert('pow(max(v0, vec4(0.0)), u_vs0)', emitted('^'))
  assert('vec4(equal(v0, u_vs0))', emitted('=='))
  assert('vec4(notEqual(v0, u_vs0))', emitted('!='))
  assert('vec4(lessThanEqual(v0, u_vs0))', emitted('<='))
  assert('vec4(greaterThanEqual(v0, u_vs0))', emitted('>='))
  assert('vec4(lessThan(v0, u_vs0))', emitted('<'))
  assert('vec4(greaterThan(v0, u_vs0))', emitted('>'))

  assert(true, shaderNodeOps['+']('lhsAst', node, 'rhsAst', 2).isShaderNode)
  assert(true, shaderNodeOps['+'](undefined, undefined, 'rhsAst', node) === node) // missing side is a no-op
  assert(true, shaderNodeOps['+']('lhsAst', node, undefined, undefined) === node)

  console.log('Shader node operator tests complete')
  }

  return {
    shaderNodeOps: shaderNodeOps,
  }
})
