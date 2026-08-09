'use strict'
define(function(require) {
  let {addNodeFunction} = require('play/nodes/node-var')
  let addVarFunction = require('predefined-vars').addVarFunction
  let {makeShaderNode,passthroughShaderNode,channelNames,unwrapValue} = require('draw/visualsynth/shader-node')
  let texture = require('draw/texture')
  let webcam = require('draw/webcam')

  let swizzle = ['x', 'y', 'z', 'w']

  // Pass the incoming value through unchanged. Seeds an operator-only chain, eg px=id/2+#080
  let id = (args, e, b, state, evalRecurse) => {
    return passthroughShaderNode()
  }
  addNodeFunction('id', id)

  // Which of the 4 channels a param names, or undefined when it names none (a plain number, or
  // anything we can't read channels off), meaning it applies to all four.
  let channelMask = (v) => {
    v = unwrapValue(v)
    if (typeof v !== 'object' || v === null) { return undefined }
    let mask = channelNames.map(names => names.some(n => v[n] !== undefined))
    return mask.some(m => m) ? mask : undefined
  }

  // Work out where each channel's value comes from: the raw AST to make a uniform of, or undefined
  // for 'leave this channel alone'. Args may name channels directly (set{u:1/2}), each of which gets
  // its own uniform so it animates independently, and/or give one positional value (set{#.f..}) whose
  // channel keys say which channels it touches. A named channel wins over the positional one.
  //
  // Only the *structure* is settled here, at event time: the values stay raw ASTs so they are still
  // re-evaluated per frame. Reading the mask off a colour or map literal needs no evaluation at all,
  // since both parse to a plain object; anything else is evaluated once, purely for its key set.
  let paramSources = (args, e, b, evalRecurse) => {
    let positional = args.value
    let mask
    if (positional !== undefined) {
      let value = (typeof positional === 'object' && positional !== null) ? positional : evalRecurse(positional, e, b)
      mask = channelMask(value)
    }
    let sources = channelNames.map((names, i) => {
      let named = names.find(n => args[n] !== undefined)
      if (named !== undefined) { return args[named] }
      if (positional === undefined) { return undefined }
      return (mask === undefined || mask[i]) ? positional : undefined
    })
    // No channel named anywhere, and the positional value applies to every channel: the callers'
    // simple whole-vector form covers it, and keeps the generated shader source simpler
    let unmasked = mask === undefined && sources.every(s => s === positional) && positional !== undefined
    return { sources: sources, positional: positional, unmasked: unmasked }
  }
  let nothingNamed = (resolved) => resolved.sources.every(s => s === undefined)

  // Emit one vec4 built per channel. Uniforms are allocated in a fixed order (the positional value
  // first, then named channels in channel order) so the same expression always generates the same
  // source: the program cache is keyed on it.
  let emitChannels = (input, ctx, resolved, combine) => {
    let uniforms = new Map()
    let uniformFor = (ast) => {
      if (!uniforms.has(ast)) { uniforms.set(ast, ctx.addUniform(ast)) }
      return uniforms.get(ast)
    }
    if (resolved.positional !== undefined && resolved.sources.includes(resolved.positional)) { uniformFor(resolved.positional) }
    let components = resolved.sources.map((ast, i) => {
      let channel = `(${input}).${swizzle[i]}`
      if (ast === undefined) { return channel }
      return combine(channel, `${uniformFor(ast)}.${swizzle[i]}`)
    })
    return ctx.addStatement(`vec4(${components.join(', ')})`)
  }

  // Multiply each channel of the incoming vec4 by the (animatable) param.
  // The arg stays a raw AST: it becomes a uniform re-evaluated per frame.
  let mul = (args, e, b, state, evalRecurse) => {
    let resolved = paramSources(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      // Whole vector at once when no channel is singled out: simpler source, and an absent param
      // leans on toVec4's fallback of 1, which is neutral for a multiply
      if (resolved.unmasked || nothingNamed(resolved)) { return ctx.addStatement(`${input} * ${ctx.addUniform(resolved.positional)}`) }
      return emitChannels(input, ctx, resolved, (channel, param) => `${channel} * ${param}`)
    })
  }
  addNodeFunction('mul', mul)

  // Add the (animatable) param to each channel of the incoming vec4. Defaults to 0 when the arg is
  // omitted: toVec4's fallback for a missing uniform is 1, which is neutral for mul but not for add.
  let add = (args, e, b, state, evalRecurse) => {
    let resolved = paramSources(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      if (resolved.unmasked) { return ctx.addStatement(`${input} + ${ctx.addUniform(resolved.positional)}`) }
      if (nothingNamed(resolved)) { return ctx.addStatement(`${input} + ${ctx.addUniform(0)}`) }
      return emitChannels(input, ctx, resolved, (channel, param) => `${channel} + ${param}`)
    })
  }
  addNodeFunction('add', add)

  // Force channels of the incoming vec4 to the (animatable) param, leaving the rest untouched;
  // eg tex{webcam{}}>>set{#.f..} forces green on, id>>set{u:1/2} pins the x coordinate.
  let set = (args, e, b, state, evalRecurse) => {
    let resolved = paramSources(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      if (resolved.unmasked) { return ctx.addStatement(ctx.addUniform(resolved.positional)) } // Every channel set: the param is the whole result
      if (nothingNamed(resolved)) { return ctx.addStatement(input) } // Nothing named: pass through
      return emitChannels(input, ctx, resolved, (channel, param) => param)
    })
  }
  addNodeFunction('set', set)

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
  // Node functions take (args, event, beat, state, evalRecurse). Only the args and the recursive
  // eval matter here: it is what reads the channels off a param that isn't already a literal
  let ev = (v) => typeof v === 'function' ? v() : v
  let node = (fn, args) => fn(args, undefined, undefined, undefined, ev)

  let ctx = mockCtx()
  assert('v1', node(id, {}).build('v0', ctx))
  assert(['v0'], ctx.statements) // Passes its input straight through

  ctx = mockCtx()
  assert('v1', node(mul, {value:ast}).build('v0', ctx))
  assert(['v0 * u_vs0'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast) // Raw AST registered, so the param stays animatable

  ctx = mockCtx()
  assert('v1', node(add, {value:ast}).build('v0', ctx))
  assert(['v0 + u_vs0'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast)

  ctx = mockCtx()
  node(add, {}).build('v0', ctx)
  assert(['v0 + u_vs0'], ctx.statements)
  assert(0, ctx.uniforms[0]) // No arg is neutral: add 0, not toVec4's missing-uniform fallback of 1

  ctx = mockCtx()
  node(mul, {}).build('v0', ctx)
  assert(['v0 * u_vs0'], ctx.statements)
  assert(undefined, ctx.uniforms[0]) // For mul the missing-uniform fallback of 1 is itself neutral

  // Named channels: only the named ones are touched, and each gets its own uniform so it animates
  // independently of the others
  ctx = mockCtx()
  assert('v1', node(set, {u:ast}).build('v0', ctx))
  assert(['vec4(u_vs0.x, (v0).y, (v0).z, (v0).w)'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast) // Raw AST again, so a named channel stays animatable

  let ast2 = () => 0.25
  ctx = mockCtx()
  node(set, {y:ast, a:ast2}).build('v0', ctx)
  assert(['vec4((v0).x, u_vs0.y, (v0).z, u_vs1.w)'], ctx.statements) // Uniforms allocated in channel order
  assert(true, ctx.uniforms[0] === ast)
  assert(true, ctx.uniforms[1] === ast2)

  ctx = mockCtx()
  node(set, {s:ast, t:ast, p:ast, q:ast}).build('v0', ctx) // Every channel named, one shared AST
  assert(['vec4(u_vs0.x, u_vs0.y, u_vs0.z, u_vs0.w)'], ctx.statements)
  assert(1, ctx.uniforms.length)

  // A positional value's own keys say which channels it touches; a colour literal parses to just
  // such an object, eg #.f.. is {g:1}
  ctx = mockCtx()
  node(set, {value:{g:1}}).build('v0', ctx)
  assert(['vec4((v0).x, u_vs0.y, (v0).z, (v0).w)'], ctx.statements)
  assert({g:1}, ctx.uniforms[0])

  ctx = mockCtx()
  node(set, {value:{g:1,a:1}}).build('v0', ctx) // #.f. is 3 digit, so it forces alpha too
  assert(['vec4((v0).x, u_vs0.y, (v0).z, u_vs0.w)'], ctx.statements)

  ctx = mockCtx()
  node(set, {value:ast}).build('v0', ctx)
  assert(['u_vs0'], ctx.statements) // A value with no channels in it replaces the lot
  ctx = mockCtx()
  node(set, {}).build('v0', ctx)
  assert(['v0'], ctx.statements) // Nothing named at all: pass through

  ctx = mockCtx()
  node(set, {value:{r:1}, g:ast}).build('v0', ctx) // A named channel wins over the positional value
  assert(['vec4(u_vs0.x, u_vs1.y, (v0).z, (v0).w)'], ctx.statements)
  assert({r:1}, ctx.uniforms[0]) // Positional uniform first, so the source is deterministic
  assert(true, ctx.uniforms[1] === ast)

  // add/mul leave the channels their param doesn't name alone
  ctx = mockCtx()
  node(add, {value:{x:0.1}}).build('v0', ctx)
  assert(['vec4((v0).x + u_vs0.x, (v0).y, (v0).z, (v0).w)'], ctx.statements) // Not alpha, which used to get the +1 default
  ctx = mockCtx()
  node(mul, {value:{x:2}}).build('v0', ctx)
  assert(['vec4((v0).x * u_vs0.x, (v0).y, (v0).z, (v0).w)'], ctx.statements) // Not y and z, which used to be zeroed
  ctx = mockCtx()
  node(add, {u:ast}).build('v0', ctx)
  assert(['vec4((v0).x + u_vs0.x, (v0).y, (v0).z, (v0).w)'], ctx.statements)
  assert(1, ctx.uniforms.length) // No pointless +0 uniforms for the untouched channels

  // The same expression must always generate the same source: the program cache is keyed on it
  let build = () => { let c = mockCtx(); node(set, {value:{b:1}, x:ast}).build('v0', c); return c.statements.join('') }
  assert(build(), build())

  console.log('Visual synth nodes tests complete')
  }

  return {
    id: id,
    mul: mul,
    add: add,
    set: set,
    tex: tex,
    webcam: webcamSource,
  }
})
