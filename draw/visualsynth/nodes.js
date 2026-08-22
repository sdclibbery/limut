'use strict'
define(function(require) {
  let {addNodeFunction} = require('play/nodes/node-var')
  let addVarFunction = require('predefined-vars').addVarFunction
  let {makeShaderNode,passthroughShaderNode,implicitInputNode,isShaderNode,channelNames,components,unwrapValue,isConvertedColour} = require('draw/visualsynth/shader-node')
  let texture = require('draw/texture')
  let webcam = require('draw/webcam')
  let {lutTexture,resolveSize,defaultSizes} = require('draw/visualsynth/lut')
  let connectOp = require('expression/connectOp')
  let {evalParamFrame} = require('player/eval-param')

  // The incoming value, passed through unchanged. Every px chain is seeded with it (see
  // player/params.js), so `id` is only needed by name to use the incoming value inside an
  // expression, eg px=id/2+#080 or px=dot{id,#3b1}. `id>>X` and `X` mean the same thing.
  let id = (args, e, b, state, evalRecurse) => {
    return implicitInputNode()
  }
  addNodeFunction('id', id)

  // The value the whole chain started with — the pixel coordinate — still available after nodes
  // downstream have replaced the value flowing through them, eg px=perlin2>>mul{y:uv.v}. Emits no
  // statement: the seed is a local of main() and every generated statement lands in main(), so it
  // is in scope everywhere, including inside a channels{} arg or a user defined visual function.
  // Not marked _implicitInput — that flag means 'this is the chain seed and >> may withhold it
  // from a call', where uv is a value in its own right.
  let uv = (args, e, b, state, evalRecurse) => {
    return makeShaderNode((input, ctx) => ctx.rootInput)
  }
  addNodeFunction('uv', uv)

  // Which of the 4 channels a param names, or undefined when it names none (a plain number, or
  // anything we can't read channels off), meaning it applies to all four.
  //
  // An hsv or lab colour names r, g and b however few of its own components are given, and alpha
  // only when it says so — so set{{h:1/3}} leaves alpha alone exactly as set{#f00} does. It has to
  // be answered before the channel table, since its s and v are channel names in their own right
  // and {h:1/3,s:1/2,v:1} would otherwise mask x and y instead. toVec4 uses the same discriminator.
  let channelMask = (v) => {
    v = unwrapValue(v)
    if (typeof v !== 'object' || v === null) { return undefined }
    if (isConvertedColour(v)) { return [true, true, true, v.a !== undefined] }
    let mask = channelNames.map(names => names.some(n => v[n] !== undefined))
    return mask.some(m => m) ? mask : undefined
  }

  // Work out where each channel's value comes from: the AST to take the value from, or undefined
  // for 'leave this channel alone'. Args may name channels directly (set{u:1/2}), each of which gets
  // its own uniform so it animates independently, and/or give one positional value (set{#.f..}) whose
  // channel keys say which channels it touches. A named channel wins over the positional one.
  //
  // Only the *structure* is settled here, at event time. Each distinct arg is evaluated once, so a
  // param that turns out to be a visual node (set{u:in.v}) can be built into the chain; everything
  // else keeps its raw AST and so is still re-evaluated per frame. Reading the mask off a colour or
  // map literal needs no evaluation at all, since both parse to a plain object.
  let paramSources = (args, e, b, evalRecurse) => {
    let positional = args.value
    let evalled = new Map()
    let nodes = new Map()
    let resolve = (ast) => {
      if (!evalled.has(ast)) {
        // An object is already the value: a colour or map literal (whose keys are the mask, read
        // with no evaluation at all) or a node handed straight in. Anything else is an expression,
        // and so a px chain in its own right.
        let value = (typeof ast === 'object' && ast !== null) ? ast : paramChain(ast, e, b, evalRecurse, true)
        evalled.set(ast, value)
        if (isShaderNode(value)) { nodes.set(ast, value) }
      }
      return evalled.get(ast)
    }
    let mask
    if (positional !== undefined) { mask = channelMask(resolve(positional)) }
    let sources = channelNames.map((names, i) => {
      let named = names.find(n => args[n] !== undefined)
      if (named !== undefined) {
        resolve(args[named]) // Evaluated for its own sake: is this channel's value a visual node?
        return args[named]
      }
      if (positional === undefined) { return undefined }
      return (mask === undefined || mask[i]) ? positional : undefined
    })
    // No channel named anywhere, and the positional value applies to every channel: the callers'
    // simple whole-vector form covers it, and keeps the generated shader source simpler
    let unmasked = mask === undefined && sources.every(s => s === positional) && positional !== undefined
    return { sources: sources, positional: positional, unmasked: unmasked, nodes: nodes }
  }
  let nothingNamed = (resolved) => resolved.sources.every(s => s === undefined)

  // The GLSL for one param: a visual node is built into the chain, reading the same incoming value
  // the node it is a param of does; anything else becomes a uniform from its raw AST, so it animates.
  let sourceExpr = (resolved, ast, input, ctx) => {
    let node = resolved.nodes.get(ast)
    if (node !== undefined) { return `(${node.build(input, ctx)})` }
    return ctx.addUniform(ast)
  }

  // Emit one vec4 built per channel. Params are resolved in a fixed order (the positional value
  // first, then named channels in channel order) so the same expression always generates the same
  // source: the program cache is keyed on it.
  let emitChannels = (input, ctx, resolved, combine) => {
    let refs = new Map()
    let refFor = (ast) => {
      if (!refs.has(ast)) { refs.set(ast, sourceExpr(resolved, ast, input, ctx)) }
      return refs.get(ast)
    }
    if (resolved.positional !== undefined && resolved.sources.includes(resolved.positional)) { refFor(resolved.positional) }
    let parts = resolved.sources.map((ast, i) => {
      let channel = `(${input}).${components[i]}`
      if (ast === undefined) { return channel }
      return combine(channel, `${refFor(ast)}.${components[i]}`)
    })
    return ctx.addStatement(`vec4(${parts.join(', ')})`)
  }

  // Multiply each channel of the incoming vec4 by the (animatable) param.
  // The arg stays a raw AST: it becomes a uniform re-evaluated per frame.
  let mul = (args, e, b, state, evalRecurse) => {
    let resolved = paramSources(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      // Whole vector at once when no channel is singled out: simpler source, and an absent param
      // leans on toVec4's fallback of 1, which is neutral for a multiply
      if (resolved.unmasked || nothingNamed(resolved)) { return ctx.addStatement(`${input} * ${sourceExpr(resolved, resolved.positional, input, ctx)}`) }
      return emitChannels(input, ctx, resolved, (channel, param) => `${channel} * ${param}`)
    })
  }
  addNodeFunction('mul', mul)

  // Add the (animatable) param to each channel of the incoming vec4. Defaults to 0 when the arg is
  // omitted: toVec4's fallback for a missing uniform is 1, which is neutral for mul but not for add.
  let add = (args, e, b, state, evalRecurse) => {
    let resolved = paramSources(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      if (resolved.unmasked) { return ctx.addStatement(`${input} + ${sourceExpr(resolved, resolved.positional, input, ctx)}`) }
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
      if (resolved.unmasked) { return ctx.addStatement(sourceExpr(resolved, resolved.positional, input, ctx)) } // Every channel set: the param is the whole result
      if (nothingNamed(resolved)) { return ctx.addStatement(input) } // Nothing named: pass through
      return emitChannels(input, ctx, resolved, (channel, param) => param)
    })
  }
  addNodeFunction('set', set)

  // Which arg feeds each channel: the positional args in channel order (value, value1, value2,
  // value3), with a named channel arg winning its own slot, as it does for set/add/mul.
  let channelArgs = (args) => channelNames.map((names, i) => {
    let named = names.find(n => args[n] !== undefined)
    if (named !== undefined) { return args[named] }
    return args['value'+(i||'')]
  })

  // Every arg of a call is evaluated once before the call itself, by the modifier machinery
  // (evalFunctionWithModifiers in eval-param.js, since a lookup's args double as its time modifiers)
  // — even for a node function, which asked not to have its args evalled. That evaluation is
  // memoised on the event, so resolving an arg here has to opt out of memoisation, or >> gets that
  // earlier un-piped value handed back instead of building the chain: `floor{1/8}+1/2` would compile
  // to a constant rather than flooring the channel. Same protocol as the lut sampling in lut.js.
  let unmemoised = (evalRecurse) => {
    let options = Object.assign({}, evalRecurse.options, {doNotMemoise:true})
    let er = (v, e, b, more) => evalParamFrame(v, e, b, more !== undefined ? Object.assign({}, options, more) : options)
    er.options = options // >> reads expandingChords off here
    return er
  }

  // Resolve an arg as a px chain in its own right: hand it to >> from the chain seed, exactly as
  // player/params.js seeds a px param, so every rule px already has holds inside the arg too — a
  // bare call or a user defined function takes the value, `floor{1/8}+1/2` feeds its head, and a
  // plain value stays a plain value. Gives back the node, or, for an arg that was not visual at
  // all, the value it evaluated to: >> wraps such a value into a uniform node, and the mark on that
  // wrapper (shader-node.js) is what tells the two apart.
  //
  // paramSlot marks the seed for the stricter rule >> uses on a mul/add/set param, where a call that
  // was given a value of its own keeps it (see connectOp.js); a channels{} arg is a chain like any
  // other. The mark is on the seed, so a chain written out inside the arg is unaffected by it.
  let paramChain = (ast, e, b, evalRecurse, paramSlot) => {
    let v = connectOp(implicitInputNode(paramSlot), ast, e, b, unmemoised(evalRecurse))
    if (!isShaderNode(v)) { return v } // A piped call that was not shader aware at all (mul{time})
    return v._constWrapped === true ? v._constValue : v
  }

  // Each arg is a px chain in its own right, fed that one channel: it is resolved by handing it to
  // >> from the chain seed, exactly as player/params.js seeds a px param, so every rule px already
  // has holds inside the arg too — `sin{id*2}` keeps its argument, a bare `sin` or a user defined
  // function takes the channel implicitly, `floor{1/8}+1/2` feeds its head, and a plain value
  // becomes an animated uniform. Gives undefined for an arg that isn't visual at all (channels{rand}),
  // which the build then treats as a uniform so it still animates.
  let channelChain = (ast, e, b, evalRecurse) => {
    if (ast === undefined) { return undefined }
    let v = paramChain(ast, e, b, evalRecurse)
    return isShaderNode(v) ? v : undefined
  }

  // Split the incoming value into its four channels, run an expression on each, and recombine;
  // eg px=channels{sin{id*1},sin{id*2},sin{id*3}}. A channel with no expression passes through.
  // Each channel is splatted across all four components on the way in, the same convention as a
  // single channel read (in.v), so `id` inside the expression behaves as a scalar; the matching
  // component of the result is taken back out, as it is for a channel param in emitChannels.
  let channels = (args, e, b, state, evalRecurse) => {
    let asts = channelArgs(args)
    let nodes = asts.map(ast => channelChain(ast, e, b, evalRecurse)) // Resolved in channel order: the source must stay deterministic
    return makeShaderNode((input, ctx) => {
      if (asts.every(a => a === undefined)) { return ctx.addStatement(input) } // Nothing named: pass through
      let parts = asts.map((ast, i) => {
        let channel = `(${input}).${components[i]}`
        if (ast === undefined) { return channel }
        if (nodes[i] === undefined) { return `${ctx.addUniform(ast)}.${components[i]}` }
        let splat = ctx.addStatement(`vec4(${channel})`)
        return `(${nodes[i].build(splat, ctx)}).${components[i]}`
      })
      return ctx.addStatement(`vec4(${parts.join(', ')})`)
    })
  }
  addNodeFunction('channels', channels)

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
      ctx.addRaw(`float ar${idx} = u_vsex${idx}.y > 0.0 ? u_vsex${idx}.x / u_vsex${idx}.y : 1.0;`)
      ctx.addRaw(`if (ar${idx} > 1.0) { uv${idx}.x /= ar${idx}; } else { uv${idx}.y *= ar${idx}; }`)
      ctx.addRaw(`uv${idx}.y = -uv${idx}.y;`)
      ctx.addRaw(`uv${idx} = uv${idx} * 0.5 + 0.5;`)
      return ctx.addStatement(`texture(${sampler}, fract(uv${idx}))`)
    })
  }
  addNodeFunction('tex', tex)

  // Look the incoming value up in a texture generated by sampling a limut expression over the unit
  // domain: tex1d on the x (ie r) channel, tex2d on xy, tex3d on xyz. Colour in, colour out, so
  // px=tex{webcam{}}>>tex1d{{x}->{labh:x}} recolours the camera through a lab hue sweep.
  //
  // The size is structural: settled at event time and baked into the source as a literal, so
  // different sizes are simply different programs and the source stays deterministic. Each axis
  // maps onto texel centres so the expression's 0 and 1 land exactly on the first and last texel.
  let lookupExpr = (input, channel, size) => `(clamp((${input}).${channel}, 0.0, 1.0)*${(size-1).toFixed(1)} + 0.5)/${size.toFixed(1)}`
  let lutNode = (t, dims, size) => {
    return makeShaderNode((input, ctx) => {
      let sampler = ctx.addTexture(t, dims === 3 ? 'sampler3D' : 'sampler2D')
      let coords = components.slice(0, dims).map(c => lookupExpr(input, c, size))
      if (dims === 1) { coords.push('0.5') } // A 1d lut is a size x 1 texture: sample down its middle
      return ctx.addStatement(`texture(${sampler}, vec${dims === 3 ? 3 : 2}(${coords.join(', ')}))`)
    })
  }
  let lut = (dims) => (args, e, b, state, evalRecurse) => {
    let size = resolveSize(evalRecurse(args.size, e, b), dims)
    // Sampled and uploaded at event time: build must stay a pure string emitter
    return lutNode(lutTexture(args.value, dims, size, e, b), dims, size)
  }
  let tex1d = lut(1)
  let tex2d = lut(2)
  let tex3d = lut(3)
  addNodeFunction('tex1d', tex1d)
  addNodeFunction('tex2d', tex2d)
  addNodeFunction('tex3d', tex3d)

  // A colour ramp from a list of stops: the incoming value picks a point along them, evenly spaced
  // over 0 to 1 and mixed linearly between, so px=sdstar>>pal{0,#408,red,1} runs black, purple, red,
  // white. It reads one channel (x, ie r) of the incoming value, as tex1d does, so a distance or a
  // noise field — a single number splatted across all four — pipes straight in.
  //
  // Only the number of stops is structural: it is baked into the source as a literal, so different
  // stop counts are different programs. Every stop is a uniform, which is the difference from tex1d:
  // nothing is frozen into a texture, so the colours stay live and can be animated.
  //
  // Each positional arg is a stop: value, value1, value2, … Each is a px chain in its own right,
  // resolved the way a mul/add/set param is, so a stop may be a node (pal{0,tex{'mask.png'},1}) while
  // a call with a value of its own (pal{0,rand,1}) keeps it rather than being handed the pixel.
  let palStops = (args, e, b, evalRecurse) => {
    let stops = []
    for (let i = 0; args['value'+(i||'')] !== undefined; i++) {
      let ast = args['value'+(i||'')]
      // A colour or map literal is already the value; anything else is an expression to resolve
      let value = (typeof ast === 'object' && ast !== null) ? ast : paramChain(ast, e, b, evalRecurse, true)
      stops.push({ ast: ast, node: isShaderNode(value) ? value : undefined })
    }
    return stops
  }
  let pal = (args, e, b, state, evalRecurse) => {
    let stops = palStops(args, e, b, evalRecurse)
    return makeShaderNode((input, ctx) => {
      // A node stop builds from the same input pal itself sees; anything else becomes a uniform
      // from its raw AST, so it is re-evaluated per frame
      let stopExpr = (s) => s.node !== undefined ? `(${s.node.build(input, ctx)})` : ctx.addUniform(s.ast)
      if (stops.length === 0) { return ctx.addStatement(input) } // No stops: nothing to look up
      if (stops.length === 1) { return ctx.addStatement(stopExpr(stops[0])) } // One stop: flat colour
      let n = stops.length
      // Stop k fades in over t running k-1 to k, so with t spanning 0 to n-1 each segment is its own
      // mix and the ends clamp flat
      let t = ctx.addStatement(`vec4(clamp((${input}).x, 0.0, 1.0) * ${(n-1).toFixed(1)})`)
      let out = stopExpr(stops[0])
      for (let k = 1; k < n; k++) {
        out = ctx.addStatement(`mix(${out}, ${stopExpr(stops[k])}, clamp(${t} - ${(k-1).toFixed(1)}, 0.0, 1.0))`)
      }
      return out
    })
  }
  addNodeFunction('pal', pal)

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
    let ctx = { statements: [], uniforms: [], textures: [], rootInput: 'v0' }
    ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
    ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
    ctx.addTexture = (tex, sampler) => { ctx.textures.push({texture:tex, sampler:sampler||'sampler2D'}); return 'u_vstex' + (ctx.textures.length-1) }
    return ctx
  }

  let ast = () => 0.5
  // Node functions take (args, event, beat, state, evalRecurse). Only the args and the recursive
  // eval matter here: it is what reads the channels off a param that isn't already a literal
  let ev = (v) => typeof v === 'function' ? v() : v
  let node = (fn, args) => fn(args, undefined, undefined, undefined, ev)

  let ctx = mockCtx()
  assert('v0', node(id, {}).build('v0', ctx))
  assert([], ctx.statements) // Passes its input straight through, emitting nothing at all
  assert(true, node(id, {})._implicitInput) // Marked as the chain seed, so >> knows it can withhold it

  // uv ignores the value flowing into it and gives the one the whole chain started with, emitting
  // nothing at all: the seed is in scope for the whole shader
  ctx = mockCtx()
  assert('v0', node(uv, {}).build('v3', ctx))
  assert([], ctx.statements)
  assert(undefined, node(uv, {})._implicitInput) // A value in its own right, not the chain seed

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

  // An hsv or lab colour names r, g and b whatever its own keys are: s and v are its saturation
  // and value, not the x and y channels, and alpha is left alone unless it says otherwise
  ctx = mockCtx()
  node(set, {value:{h:1/3}}).build('v0', ctx)
  assert(['vec4(u_vs0.x, u_vs0.y, u_vs0.z, (v0).w)'], ctx.statements)
  ctx = mockCtx()
  node(set, {value:{h:1/3,s:1/2,v:1}}).build('v0', ctx)
  assert(['vec4(u_vs0.x, u_vs0.y, u_vs0.z, (v0).w)'], ctx.statements)
  ctx = mockCtx()
  node(set, {value:{h:1/3,a:1/2}}).build('v0', ctx)
  assert(['vec4(u_vs0.x, u_vs0.y, u_vs0.z, u_vs0.w)'], ctx.statements)
  ctx = mockCtx()
  node(mul, {value:{labh:0}}).build('v0', ctx)
  assert(['vec4((v0).x * u_vs0.x, (v0).y * u_vs0.y, (v0).z * u_vs0.z, (v0).w)'], ctx.statements)

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

  // A channel's value can be a visual node instead of a param: it builds from the same incoming
  // value the node it belongs to sees, and the matching channel of its result is taken
  let {swizzleShaderNode} = require('draw/visualsynth/shader-node')
  let swapUV = () => swizzleShaderNode(passthroughShaderNode(), 'vu') // As `in.vu` evaluates to
  ctx = mockCtx()
  node(set, {u:swapUV()}).build('v0', ctx)
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', 'vec4((v2).x, (v0).y, (v0).z, (v0).w)'], ctx.statements)
  assert(0, ctx.uniforms.length) // A node is built, not made a uniform

  ctx = mockCtx()
  node(set, {u:swapUV(), v:ast}).build('v0', ctx) // A node channel and an ordinary param channel
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', 'vec4((v2).x, u_vs0.y, (v0).z, (v0).w)'], ctx.statements)
  assert(true, ctx.uniforms[0] === ast) // The other channel still animates

  ctx = mockCtx()
  node(mul, {value:swapUV()}).build('v0', ctx) // A node as the whole param: eg mul{tex{'mask.png'}}
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', 'v0 * (v2)'], ctx.statements)
  ctx = mockCtx()
  node(add, {value:swapUV()}).build('v0', ctx)
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', 'v0 + (v2)'], ctx.statements)
  ctx = mockCtx()
  node(set, {value:swapUV()}).build('v0', ctx)
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', '(v2)'], ctx.statements)

  // An arg shared by two channels is evaluated and built once
  ctx = mockCtx()
  let shared = swapUV()
  node(set, {u:shared, v:shared}).build('v0', ctx)
  assert(['v0', 'vec4((v1).y, (v1).x, (v1).z, (v1).w)', 'vec4((v2).x, (v2).y, (v0).z, (v0).w)'], ctx.statements)

  // The same expression must always generate the same source: the program cache is keyed on it
  let build = () => { let c = mockCtx(); node(set, {value:{b:1}, x:ast}).build('v0', c); return c.statements.join('') }
  assert(build(), build())
  let buildNode = () => { let c = mockCtx(); node(set, {u:swapUV(), g:ast}).build('v0', c); return c.statements.join('') }
  assert(buildNode(), buildNode())

  // Lookup textures. The incoming channels index the lut, clamped, and mapped onto texel centres so
  // the sampled expression's 0 and 1 land exactly on the first and last texel
  let stubLut = {tex:'stub'}
  ctx = mockCtx()
  assert('v1', lutNode(stubLut, 1, 4).build('v0', ctx))
  assert(['texture(u_vstex0, vec2((clamp((v0).x, 0.0, 1.0)*3.0 + 0.5)/4.0, 0.5))'], ctx.statements)
  assert('sampler2D', ctx.textures[0].sampler) // A 1d lut is a size x 1 2d texture: WebGL has no 1d textures
  assert(true, ctx.textures[0].texture === stubLut)

  ctx = mockCtx()
  lutNode(stubLut, 2, 4).build('v0', ctx)
  assert(['texture(u_vstex0, vec2((clamp((v0).x, 0.0, 1.0)*3.0 + 0.5)/4.0, (clamp((v0).y, 0.0, 1.0)*3.0 + 0.5)/4.0))'], ctx.statements)
  assert('sampler2D', ctx.textures[0].sampler)

  ctx = mockCtx()
  lutNode(stubLut, 3, 2).build('v0', ctx)
  assert(['texture(u_vstex0, vec3((clamp((v0).x, 0.0, 1.0)*1.0 + 0.5)/2.0, (clamp((v0).y, 0.0, 1.0)*1.0 + 0.5)/2.0, (clamp((v0).z, 0.0, 1.0)*1.0 + 0.5)/2.0))'], ctx.statements)
  assert('sampler3D', ctx.textures[0].sampler) // Only a 3d lut needs the 3d sampler

  // The size is baked in, so a different size is a different program, and the source stays
  // byte-identical for the same size: the program cache is keyed on it
  let buildLut = (size) => { let c = mockCtx(); lutNode(stubLut, 1, size).build('v0', c); return c.statements.join('') }
  assert(buildLut(8), buildLut(8))
  assert(true, buildLut(8) !== buildLut(16))

  // pal{}: a ramp of evenly spaced colour stops. Only the count is structural — it is baked in as
  // the scale on t and the offset on each segment — so the stops themselves stay uniforms and can
  // animate, which is the difference from a lut.
  ctx = mockCtx()
  assert('v2', node(pal, {value:0, value1:1}).build('v0', ctx))
  assert([
    'vec4(clamp((v0).x, 0.0, 1.0) * 1.0)',
    'mix(u_vs0, u_vs1, clamp(v1 - 0.0, 0.0, 1.0))',
  ], ctx.statements)
  assert([0, 1], ctx.uniforms) // Each stop keeps its own raw AST, so it is re-evalled per frame

  // Four stops: three segments, t spanning 0 to 3, each stop faded in over one of them
  ctx = mockCtx()
  node(pal, {value:0, value1:{r:1}, value2:{g:1}, value3:1}).build('v0', ctx)
  assert([
    'vec4(clamp((v0).x, 0.0, 1.0) * 3.0)',
    'mix(u_vs0, u_vs1, clamp(v1 - 0.0, 0.0, 1.0))',
    'mix(v2, u_vs2, clamp(v1 - 1.0, 0.0, 1.0))',
    'mix(v3, u_vs3, clamp(v1 - 2.0, 0.0, 1.0))',
  ], ctx.statements)

  // One stop is a flat colour, and no stops at all passes the value through: neither needs a t
  ctx = mockCtx()
  assert('v1', node(pal, {value:{r:1}}).build('v0', ctx))
  assert(['u_vs0'], ctx.statements)
  ctx = mockCtx()
  assert('v1', node(pal, {}).build('v0', ctx))
  assert(['v0'], ctx.statements)

  // A stop may be a node, and it builds from the same input pal itself sees rather than chaining
  ctx = mockCtx()
  node(pal, {value:0, value1:swapUV(), value2:1}).build('v0', ctx)
  assert([
    'vec4(clamp((v0).x, 0.0, 1.0) * 2.0)',
    'v0', // The pass-through the swizzle reads: the node stop sees v0, the same input pal does
    'vec4((v2).y, (v2).x, (v2).z, (v2).w)',
    'mix(u_vs0, (v3), clamp(v1 - 0.0, 0.0, 1.0))',
    'mix(v4, u_vs1, clamp(v1 - 1.0, 0.0, 1.0))',
  ], ctx.statements)
  assert([0, 1], ctx.uniforms)

  // Deterministic, and a different stop count is a different program: the cache is keyed on it
  let buildPal = (args) => { let c = mockCtx(); node(pal, args).build('v0', c); return c.statements.join('') }
  assert(buildPal({value:0, value1:{r:1}, value2:1}), buildPal({value:0, value1:{r:1}, value2:1}))
  assert(true, buildPal({value:0, value1:1}) !== buildPal({value:0, value1:{r:1}, value2:1}))

  // End to end: an arithmetic expression compiles to the same shader as the >> form it reads like,
  // because the call at its head takes the incoming pixel value (expressionHead in connectOp.js).
  // Both spellings are parsed and evalled here exactly as a px param is, seed and all.
  require('functions/maths') // Side-effect: register floor/sin, used below
  require('predefined-vars').apply(require('vars').all())
  let parseExpression = require('expression/parse-expression')
  let {evalParamEvent} = require('player/eval-param')
  let {buildSource} = require('draw/visualsynth/codegen')
  let pxSource = (text) => buildSource(evalParamEvent(parseExpression('id>>'+text), {idx:0,count:0})).source
  assert(pxSource('floor{1/8}>>add{1/2}'), pxSource('floor{1/8}+1/2'))
  assert(pxSource('sin>>add{1/4}'), pxSource('sin+1/4'))
  // mul{#0f0} takes the masked-channel path where * does not, so these two are equivalent rather
  // than identical: what matters is that sin is applied to the incoming value (v1, the pass-through
  // of v0 that any piped call is handed) rather than being called with nothing
  assert(true, pxSource('sin*#0f0').includes('sin(v1)'))

  // A chain nested inside another one is seeded like any other, so the call at its head takes the
  // incoming value (expressionHead walks >> too). Bracketing a chain changes nothing.
  assert(pxSource('floor{1/8}>>add{1/2}'), pxSource('(floor{1/8}>>add{1/2})'))

  // channels{}: each channel is splatted in on its own, the arg's expression runs on it, and the
  // matching component comes back out. Untouched channels are read straight off the input.
  let src = pxSource('channels{sin{id*2}}')
  assert(true, src.includes('vec4((v0).x)')) // Channel 0 splatted across all four
  assert(true, src.includes('sin(')) // The expression compiled in
  assert(true, /vec4\(\(v\d+\)\.x, \(v0\)\.y, \(v0\)\.z, \(v0\)\.w\)/.test(src)) // Recombined; the other three pass through
  assert(false, src.includes('vec4((v0).y)')) // No arg for them, so nothing emitted for them either

  // An arg follows the same rules a px value does, because it is resolved through >> from the chain
  // seed: a bare call takes the channel, and an arithmetic expression feeds the call at its head
  // (both of which would otherwise compile to nothing at all, having been called with no value)
  src = pxSource('channels{sin}')
  assert(true, src.includes('vec4((v0).x)') && src.includes('sin('))
  src = pxSource('channels{floor{1/8}+1/2}')
  assert(true, src.includes('vec4((v0).x)') && src.includes('floor('))
  assert(pxSource('channels{floor{1/8}>>add{1/2}}'), src) // The >> spelling of the same thing
  src = pxSource('channels{id^2}') // And an expression naming the channel with id
  assert(true, src.includes('vec4((v0).x)') && src.includes('pow('))

  src = pxSource('channels{sin{id},sin{id}}') // Two channels mapped, each with its own splat
  assert(2, (src.match(/sin\(/g) || []).length)
  assert(true, src.includes('vec4((v0).x)') && src.includes('vec4((v0).y)'))
  assert(true, /vec4\(\(v\d+\)\.x, \(v\d+\)\.y, \(v0\)\.z, \(v0\)\.w\)/.test(src))

  src = pxSource('channels{g:sin{id}}') // Named channel: only that one is touched
  assert(true, src.includes('vec4((v0).y)'))
  assert(true, /vec4\(\(v0\)\.x, \(v\d+\)\.y, \(v0\)\.z, \(v0\)\.w\)/.test(src))
  assert(pxSource('channels{g:sin{id}}'), pxSource('channels{value1:sin{id}}')) // Same slot either way

  src = pxSource('channels{1/2}') // Not visual: the raw expression becomes a uniform, so it still animates
  assert(true, /vec4\(u_vs0\.x, \(v0\)\.y, \(v0\)\.z, \(v0\)\.w\)/.test(src)) // Read straight off the uniform
  assert(false, src.includes('sin(')) // Nothing else compiled in

  assert(pxSource('set{}'), pxSource('channels{}')) // No args at all: straight through, as set{} is

  assert(pxSource('channels{sin{id},g:id^2}'), pxSource('channels{sin{id},g:id^2}')) // Deterministic: the program cache is keyed on the source

  // uv: the value the whole chain started with, still reachable once nodes downstream have
  // replaced the value flowing through them. At the head of a chain it is exactly what id is.
  assert(pxSource('uv'), pxSource('id'))
  assert(true, pxSource('uv').includes('fragColor = v0;')) // And neither emits anything at all

  src = pxSource('mul{2}>>mul{y:uv.v}') // The coordinates, not the multiplied value
  assert(true, src.includes('vec4 v1 = v0 * u_vs0;'))
  assert(true, src.includes('vec4 v2 = vec4((v0).y);')) // Read off the seed
  assert(false, src.includes('vec4((v1).y);')) // Not off what is coming down the chain
  assert(true, src.includes('vec4 v3 = vec4((v1).x, (v1).y * (v2).y, (v1).z, (v1).w);'))

  // It works anywhere an expression does, so a 0 to 1 ramp is uv.v/2+1/2
  src = pxSource('pxhash>>mul{uv.v/2+1/2}')
  assert(true, src.includes('vec4((v0).y)') && src.includes('l_pxhash('))

  // And inside a channels{} arg it is still the whole chain's coordinates, where id there is the
  // one channel: that is the whole point of having it
  src = pxSource('mul{2}>>channels{g:uv.u}')
  assert(true, src.includes('vec4((v1).y)')) // The channel splatted in, off the chain value
  assert(true, src.includes('vec4((v0).x)')) // uv, off the seed

  assert(pxSource('mul{y:uv.v}'), pxSource('mul{y:uv.v}')) // Deterministic: the program cache is keyed on the source

  // pxhash: a per pixel hash of the value coming down the chain, declared as a helper function and
  // called on the incoming value. Random rgb with the incoming alpha kept, as dot does.
  let declarations = (src, name) => (src.match(new RegExp('vec4 '+name+'\\(vec4 p, vec4 s\\)', 'g')) || []).length
  src = pxSource('pxhash')
  assert(true, src.includes('vec4 v2 = vec4(l_pxhash(v1, vec4(0.0)).rgb, (v1).a);'))
  assert(1, declarations(src, 'l_pxhash'))
  assert(true, src.indexOf('vec4 l_pxhash(') < src.indexOf('void main()')) // Declared before it is called
  assert(pxSource('id>>pxhash'), src) // Writing the chain seed out changes nothing, as ever

  // The argument form has the value already, so it is not piped one: no pass-through, and it hashes
  // the incoming value directly
  assert(true, pxSource('pxhash{id}').includes('vec4 v1 = vec4(l_pxhash(v0, vec4(0.0)).rgb, (v0).a);'))
  src = pxSource('pxhash{id*3}') // And it can hash an expression of the incoming value
  assert(true, src.includes('vec4 v1 = v0 * u_vs0;') && src.includes('l_pxhash(v1, vec4(0.0))'))

  // Quantise the coordinates first for blocky noise: the floor comes before the hash. Compared
  // within main, since the helper's own declaration necessarily comes before all of it
  let body = (s) => s.slice(s.indexOf('void main()'))
  src = body(pxSource('floor{1/8}>>pxhash'))
  assert(true, src.indexOf('floor(v1 / u_vs0)') < src.indexOf('l_pxhash('))

  // A seed becomes a uniform, so it animates; with none the shader gets a literal instead
  assert(true, pxSource('pxhash{seed:2}').includes('l_pxhash(v1, u_vs0)'))
  assert(pxSource('pxhash{seed:2}'), pxSource('id>>pxhash{2}')) // Named or second positional: same slot
  assert(true, pxSource('pxhash') !== pxSource('pxhash{seed:2}'))

  // Used twice the helper is still declared once; the two hashes each get their own call
  src = pxSource('pxhash>>pxhash')
  assert(1, declarations(src, 'l_pxhash'))
  assert(2, (src.match(/l_pxhash\(v\d+,/g) || []).length)

  // pxhashf is the same node with the cheaper hash, and the two coexist
  assert(true, pxSource('pxhashf').includes('vec4 v2 = vec4(l_pxhashf(v1, vec4(0.0)).rgb, (v1).a);'))
  src = pxSource('pxhash+pxhashf{id}')
  assert(1, declarations(src, 'l_pxhash'))
  assert(1, declarations(src, 'l_pxhashf'))

  // A param is a px chain in its own right, so a call that was not given a value of its own takes
  // the incoming one: the bare mul{pxhash} is the per pixel multiply, and so are the two spellings
  // that had to say so explicitly. A named arg leaves the value slot free, so seeding it is right.
  assert(true, pxSource('mul{pxhash{id}}').includes('vec4 v1 = vec4(l_pxhash(v0, vec4(0.0)).rgb, (v0).a);'))
  assert(true, pxSource('mul{pxhash}').includes('l_pxhash('))
  assert(true, pxSource('mul{pxhash{seed:2}}').includes('l_pxhash('))
  assert(true, pxSource('mul{id>>pxhash}').includes('l_pxhash('))
  assert(true, pxSource('mul{sin}').includes('sin(')) // Any shader aware call, not just the node ones
  assert(true, pxSource('mul{id>>floor{1/8}}').includes('floor('))
  assert(true, pxSource('mul{floor{id,1/8}}').includes('floor('))

  // But a call that was given a value keeps it, so an ordinary animated scalar param still reads as
  // one: sin{time} is the sine of the time, not of the pixel. That is where a param slot parts
  // company with a chain head, which would take the value and shift time along to sin's second arg.
  src = pxSource('mul{sin{time}}')
  assert(false, src.includes('sin(')) // Evaluated, and the raw AST registered as a uniform
  assert(true, src.includes('vec4 v1 = v0 * u_vs0;'))
  assert(pxSource('mul{floor{1/8}}'), src) // Same for anything else with its value slot filled
  assert(pxSource('mul{rand}'), src) // And a call that isn't shader aware at all

  // A channels{} arg is a px chain in its own right, so a bare pxhash does take the channel there
  src = pxSource('channels{a:pxhash}')
  assert(true, src.includes('vec4 v1 = vec4((v0).w);') && src.includes('l_pxhash(v2, vec4(0.0))'))

  assert(pxSource('pxhash{seed:2}'), pxSource('pxhash{seed:2}')) // Deterministic: the program cache is keyed on the source

  // pal{} end to end. It is a node function, so >> composes it and the ramp reads the value coming
  // down the chain rather than an argument of its own.
  src = pxSource('pal{0,#408,red,1}')
  assert(true, src.includes('vec4 v1 = vec4(clamp((v0).x, 0.0, 1.0) * 3.0);'))
  assert(3, (src.match(/mix\(/g) || []).length) // One segment per gap between stops
  assert(4, (src.match(/uniform vec4 u_vs\d+;/g) || []).length) // One uniform per stop, so they animate
  // Which is what makes two ramps of the same length share a program: only the count is in the source
  assert(pxSource('pal{#f00,#00f}'), pxSource('pal{#0f0,#ff0}'))
  assert(true, pxSource('pal{#f00,#00f}') !== pxSource('pal{#f00,#0f0,#00f}'))
  // Piped, the ramp reads what the chain gives it, not the raw coordinate
  src = pxSource('sin>>pal{0,1}')
  assert(false, src.includes('clamp((v0).x'))
  assert(true, /clamp\(\(v\d+\)\.x, 0\.0, 1\.0\) \* 1\.0/.test(src))



  console.log('Visual synth nodes tests complete')
  }

  return {
    id: id,
    uv: uv,
    mul: mul,
    add: add,
    set: set,
    channels: channels,
    tex: tex,
    tex1d: tex1d,
    tex2d: tex2d,
    tex3d: tex3d,
    webcam: webcamSource,
  }
})
