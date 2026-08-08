'use strict'
define(function(require) {
  let {addNodeFunction} = require('play/nodes/node-var')
  let addVarFunction = require('predefined-vars').addVarFunction
  let {makeShaderNode,passthroughShaderNode} = require('draw/visualsynth/shader-node')
  let texture = require('draw/texture')
  let webcam = require('draw/webcam')

  // Pass the incoming value through unchanged. Seeds an operator-only chain, eg px=id/2+#080
  let id = (args, e, b, state, evalRecurse) => {
    return passthroughShaderNode()
  }
  addNodeFunction('id', id)

  // Multiply each channel of the incoming vec4 by the (animatable) param.
  // The arg stays a raw AST: it becomes a uniform re-evaluated per frame.
  let mul = (args, e, b, state, evalRecurse) => {
    return makeShaderNode((input, ctx) => ctx.addStatement(`${input} * ${ctx.addUniform(args.value)}`))
  }
  addNodeFunction('mul', mul)

  // Add the (animatable) param to each channel of the incoming vec4. Defaults to 0 when the arg is
  // omitted: toVec4's fallback for a missing uniform is 1, which is neutral for mul but not for add.
  let add = (args, e, b, state, evalRecurse) => {
    let arg = args.value !== undefined ? args.value : 0
    return makeShaderNode((input, ctx) => ctx.addStatement(`${input} + ${ctx.addUniform(arg)}`))
  }
  addNodeFunction('add', add)

  // Sample a texture at the incoming value's xy. Arg is a url string or a texture source like webcam{}.
  let tex = (args, e, b, state, evalRecurse) => {
    let src = evalRecurse(args.value, e, b)
    let t
    if (typeof src === 'string') {
      t = texture(src)
    } else if (typeof src === 'object' && src !== null && src.isVisualTextureSource) {
      t = src.acquire() // May be undefined until eg webcam enumeration completes
    }
    return makeShaderNode((input, ctx) => {
      let idx = ctx.textures.length
      let sampler = ctx.addTexture(t)
      ctx.addRaw(`vec2 uv${idx} = (${input}).xy;`)
      ctx.addRaw(`float ar${idx} = l_extents.y > 0.0 ? l_extents.x / l_extents.y : 1.0;`)
      ctx.addRaw(`if (ar${idx} > 1.0) { uv${idx}.x /= ar${idx}; } else { uv${idx}.y *= ar${idx}; }`)
      ctx.addRaw(`uv${idx}.y = -uv${idx}.y;`)
      ctx.addRaw(`uv${idx} = uv${idx} * 0.5 + 0.5;`)
      return ctx.addStatement(`texture(${sampler}, fract(uv${idx}))`)
    })
  }
  addNodeFunction('tex', tex)

  // Texture source for tex{}: webcam{'label'} or webcam{2}, with optional width/height
  let webcamSource = (args, e, b) => {
    let device = args.value !== undefined ? args.value : args.device
    return {
      isVisualTextureSource: true,
      acquire: () => webcam.acquireTexture(device, args.width, args.height),
    }
  }
  addVarFunction('webcam', webcamSource)

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

  let ast = () => 0.5

  let ctx = mockCtx()
  assert('v1', id({}).build('v0', ctx))
  assert(['v0'], ctx.statements) // Passes its input straight through

  ctx = mockCtx()
  assert('v1', mul({value:ast}).build('v0', ctx))
  assert(['v0 * u_vs0'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast) // Raw AST registered, so the param stays animatable

  ctx = mockCtx()
  assert('v1', add({value:ast}).build('v0', ctx))
  assert(['v0 + u_vs0'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast)

  ctx = mockCtx()
  add({}).build('v0', ctx)
  assert(['v0 + u_vs0'], ctx.statements)
  assert(0, ctx.uniforms[0]) // No arg is neutral: add 0, not toVec4's missing-uniform fallback of 1

  console.log('Visual synth nodes tests complete')
  }

  return {
    id: id,
    mul: mul,
    add: add,
    tex: tex,
    webcam: webcamSource,
  }
})
