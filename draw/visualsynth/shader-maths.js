'use strict'
define(function(require) {
  let {isShaderNode,naryShaderNode} = require('draw/visualsynth/shader-node')
  let {pcg4dHelper,sinHelper,hashSpec} = require('draw/visualsynth/shader-hash')

  // The maths functions work on visual nodes as well as numbers: when an argument is a shader node
  // the call compiles to GLSL instead of evaluating, the same dispatch the arithmetic operators use
  // (expression/shaderNodeOps.js). Scalar behaviour is untouched — the numeric function is simply
  // called instead. Everything in the shader is a vec4, so all of these are componentwise.
  //
  // Operands carry their raw unevalled AST alongside the evalled value, so a non-node operand
  // becomes a uniform that is re-evalled every frame rather than a constant frozen at event time.
  // parse-var supplies the raw args as __rawArgs (see wantsRawArgs), already shifted in step with
  // the evalled ones when the call was piped.

  let operand = (args, raw, key) => {
    if (args[key] === undefined) { return undefined }
    return { value: args[key], raw: (raw !== undefined && raw[key] !== undefined) ? raw[key] : args[key] }
  }

  let mainOperand = (args, raw) => [operand(args, raw, 'value')]

  // value, plus an optional second operand: named, or the second positional arg (which is where
  // `>>floor{1/40}` puts it once the piped value has taken the first slot). A name of undefined
  // means positional only, as dot and cross are.
  let optionalSecond = (name) => (args, raw) => {
    let ops = mainOperand(args, raw)
    let b = (name !== undefined ? operand(args, raw, name) : undefined) || operand(args, raw, 'value1')
    if (b !== undefined) { ops.push(b) }
    return ops
  }
  let quantiseOperands = optionalSecond('to') // floor{v,to:1/2}, and >>floor{1/2}
  let seedOperands = optionalSecond('seed') // pxhash{v,seed:2}, and >>pxhash{2}

  // value, plus an optional lo/hi pair: named, or the second and third positional args. Giving only
  // one still emits both (the other from its default) so the pair stays positional in the emit;
  // giving neither emits no operands at all, so the defaults become literals rather than uniforms.
  let rangeOperands = (loKey, hiKey, loDefault, hiDefault) => (args, raw) => {
    let ops = mainOperand(args, raw)
    let lo = operand(args, raw, loKey) || operand(args, raw, 'value1')
    let hi = operand(args, raw, hiKey) || operand(args, raw, 'value2')
    if (lo === undefined && hi === undefined) { return ops }
    ops.push(lo !== undefined ? lo : {value: loDefault, raw: loDefault})
    ops.push(hi !== undefined ? hi : {value: hiDefault, raw: hiDefault})
    return ops
  }

  // Every positional arg: min{a,b,c}
  let allOperands = (args, raw) => {
    let ops = []
    let i = 0
    let o
    while ((o = operand(args, raw, 'value'+(i||''))) !== undefined) { ops.push(o); i++ }
    return ops
  }

  let unary = (glslFn) => ({ emit: (a) => `${glslFn}(${a})`, operands: mainOperand })
  let quantise = (glslFn) => ({
    emit: (a, t) => t === undefined ? `${glslFn}(${a})` : `${glslFn}(${a} / ${t}) * ${t}`,
    operands: quantiseOperands,
  })
  // GLSL round() is allowed to break .5 ties either way, where Math.round always rounds up
  let round = {
    emit: (a, t) => t === undefined ? `floor(${a} + 0.5)` : `floor(${a} / ${t} + 0.5) * ${t}`,
    operands: quantiseOperands,
  }
  let variadic = (glslFn) => ({
    emit: (...names) => names.reduce((acc, n) => `${glslFn}(${acc}, ${n})`),
    operands: allOperands,
  })
  // A range function (clamp, smoothstep): the lo/hi pair is a literal when neither was given, so
  // the common `smoothstep{f}` fade curve costs no uniforms at all
  let ranged = (emit, loDefault, hiDefault) => ({
    emit: (a, lo, hi) => lo === undefined
      ? emit(a, `vec4(${loDefault.toFixed(1)})`, `vec4(${hiDefault.toFixed(1)})`)
      : emit(a, lo, hi),
    operands: rangeOperands('lo', 'hi', loDefault, hiDefault),
  })

  // The rgb of a vector operation, with the input's alpha kept, so a chain stays opaque rather than
  // see through. dot and length collapse to a scalar and so splat it across rgb the way a single
  // channel read does; normalize and cross keep their three components.
  let dot = {
    emit: (a, b) => `vec4(vec3(dot((${a}).rgb, (${b === undefined ? a : b}).rgb)), (${a}).a)`,
    operands: optionalSecond(),
  }
  let cross = {
    emit: (a, b) => `vec4(cross((${a}).rgb, (${b === undefined ? a : b}).rgb), (${a}).a)`,
    operands: optionalSecond(),
  }
  let length = { emit: (a) => `vec4(vec3(length((${a}).rgb)), (${a}).a)`, operands: mainOperand }
  let normalize = { emit: (a) => `vec4(normalize((${a}).rgb), (${a}).a)`, operands: mainOperand }

  // The hashes: the GLSL and the emit live in shader-hash.js, the operand shape is the local one
  let hash = (helper) => Object.assign({operands: seedOperands}, hashSpec(helper))

  let specs = {
    floor: quantise('floor'),
    ceil: quantise('ceil'),
    round: round,
    abs: unary('abs'),
    sgn: unary('sign'),
    sign: unary('sign'),
    sin: unary('sin'),
    cos: unary('cos'),
    tan: unary('tan'),
    tanh: unary('tanh'),
    // atan{y} is the one argument arctangent; atan{y,x} (named x, or the second positional) is the
    // two argument one, ie the angle of the vector x,y, which is what a polar coordinate wants
    atan: { emit: (a, b) => b === undefined ? `atan(${a})` : `atan(${a}, ${b})`, operands: optionalSecond('x') },
    fract: unary('fract'),
    sqrt: unary('sqrt'),
    exp: unary('exp'),
    // Unlike the ^ operator this does not clamp the base to zero first, so a negative base with a
    // non integer exponent is undefined in GLSL, as it is in GLSL's own pow
    pow: { emit: (a, b) => `pow(${a}, ${b === undefined ? 'vec4(2.0)' : b})`, operands: optionalSecond('by') },
    clamp: ranged((a, lo, hi) => `clamp(${a}, ${lo}, ${hi})`, 0, 1),
    smoothstep: ranged((a, lo, hi) => `smoothstep(${lo}, ${hi}, ${a})`, 0, 1),
    min: variadic('min'),
    max: variadic('max'),
    dot: dot,
    cross: cross,
    length: length,
    normalize: normalize,
    pxhash: hash(pcg4dHelper),
    pxhashf: hash(sinHelper),
  }

  let hasShaderNode = (args) => {
    if (typeof args !== 'object' || args === null) { return false }
    if (Array.isArray(args)) { return args.some(isShaderNode) }
    for (let k in args) {
      if (k === '__rawArgs') { continue } // Raw ASTs are unevalled: a node can only show up in the evalled args
      if (isShaderNode(args[k])) { return true }
    }
    return false
  }

  let copiedFlags = ['_isAggregator', '_requiresValue', 'interval', 'isNonTemporal', 'passCallsiteId']

  // Wrap a numeric var function so that it emits GLSL when handed a visual node
  let shaderAware = (name, numericFn) => {
    let spec = specs[name]
    if (spec === undefined) { throw `No visual node spec for maths function ${name}` }
    let shaderMathsFunc = (args, e,b, state, evalRecurse) => {
      if (hasShaderNode(args)) {
        let node = naryShaderNode(spec.emit, spec.operands(args, args.__rawArgs), spec.helpers)
        return {value:node, _finalResult:true} // Final: no further lookup, so postfix (id*4).floor works
      }
      return numericFn(args, e,b, state, evalRecurse)
    }
    shaderMathsFunc.wantsRawArgs = true
    copiedFlags.forEach(k => { if (numericFn[k] !== undefined) { shaderMathsFunc[k] = numericFn[k] } })
    return shaderMathsFunc
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let mockCtx = () => {
    let ctx = { statements: [], uniforms: [], functions: [] }
    ctx.addStatement = (expr) => { ctx.statements.push(expr); return 'v' + ctx.statements.length }
    ctx.addUniform = (ast) => { ctx.uniforms.push(ast); return 'u_vs' + (ctx.uniforms.length-1) }
    ctx.addFunction = (name, source) => { if (!ctx.functions.some(f => f.name === name)) { ctx.functions.push({name:name, source:source}) } return name }
    return ctx
  }
  let node = {isShaderNode:true, build: (input, ctx) => input}
  let numeric = () => 'numeric'
  let emitted = (name, args) => { // Apply the function to args, return the generated statement
    let v = shaderAware(name, numeric)(args)
    let ctx = mockCtx()
    v.value.build('v0', ctx)
    return ctx.statements[ctx.statements.length-1]
  }

  assert('floor(v0)', emitted('floor', {value:node}))
  assert('floor(v0 / u_vs0) * u_vs0', emitted('floor', {value:node, to:1/2}))
  assert('floor(v0 / u_vs0) * u_vs0', emitted('floor', {value:node, value1:1/2})) // Positional to, as >>floor{1/2}
  assert('ceil(v0 / u_vs0) * u_vs0', emitted('ceil', {value:node, to:1/2}))
  assert('floor(v0 + 0.5)', emitted('round', {value:node}))
  assert('floor(v0 / u_vs0 + 0.5) * u_vs0', emitted('round', {value:node, to:1/2}))
  assert('abs(v0)', emitted('abs', {value:node}))
  assert('sign(v0)', emitted('sgn', {value:node}))
  assert('sign(v0)', emitted('sign', {value:node}))
  assert('sin(v0)', emitted('sin', {value:node}))
  assert('cos(v0)', emitted('cos', {value:node}))
  assert('tan(v0)', emitted('tan', {value:node}))
  assert('tanh(v0)', emitted('tanh', {value:node}))
  assert('atan(v0)', emitted('atan', {value:node}))
  assert('min(v0, u_vs0)', emitted('min', {value:node, value1:1/2}))
  assert('max(max(v0, u_vs0), u_vs1)', emitted('max', {value:node, value1:1/2, value2:1/4}))
  assert('vec4(vec3(dot((v0).rgb, (u_vs0).rgb)), (v0).a)', emitted('dot', {value:node, value1:{r:1,g:0,b:0}}))
  assert('vec4(vec3(dot((v0).rgb, (v0).rgb)), (v0).a)', emitted('dot', {value:node})) // One arg dots with itself

  assert('fract(v0)', emitted('fract', {value:node}))
  assert('sqrt(v0)', emitted('sqrt', {value:node}))
  assert('exp(v0)', emitted('exp', {value:node}))
  assert('atan(v0, u_vs0)', emitted('atan', {value:node, x:1})) // Two argument arctangent
  assert('atan(v0, u_vs0)', emitted('atan', {value:node, value1:1})) // Positional x too, as >>atan{1}
  assert('pow(v0, u_vs0)', emitted('pow', {value:node, by:3}))
  assert('pow(v0, u_vs0)', emitted('pow', {value:node, value1:3}))
  assert('pow(v0, vec4(2.0))', emitted('pow', {value:node})) // Squaring by default

  // The lo/hi pair: literals when neither was given, so the plain fade curve costs no uniforms
  assert('clamp(v0, vec4(0.0), vec4(1.0))', emitted('clamp', {value:node}))
  assert('clamp(v0, u_vs0, u_vs1)', emitted('clamp', {value:node, lo:-1, hi:2}))
  assert('clamp(v0, u_vs0, u_vs1)', emitted('clamp', {value:node, value1:-1, value2:2})) // Positional, as >>clamp{-1,2}
  assert('clamp(v0, u_vs0, u_vs1)', emitted('clamp', {value:node, hi:2})) // One of the pair still emits both
  assert('smoothstep(vec4(0.0), vec4(1.0), v0)', emitted('smoothstep', {value:node}))
  assert('smoothstep(u_vs0, u_vs1, v0)', emitted('smoothstep', {value:node, lo:1/4, hi:3/4}))

  // Vector operations work on rgb and keep the incoming alpha, as dot does
  assert('vec4(vec3(length((v0).rgb)), (v0).a)', emitted('length', {value:node}))
  assert('vec4(normalize((v0).rgb), (v0).a)', emitted('normalize', {value:node}))
  assert('vec4(cross((v0).rgb, (u_vs0).rgb), (v0).a)', emitted('cross', {value:node, value1:{r:0,g:0,b:1}}))
  assert('vec4(cross((v0).rgb, (v0).rgb), (v0).a)', emitted('cross', {value:node})) // One arg crosses with itself

  // A defaulted end of the pair is a plain value, not a raw AST, so it still becomes a uniform
  let hiAst = () => 2
  let rctx = mockCtx()
  shaderAware('clamp', numeric)({value:node, hi:2, __rawArgs:{hi:hiAst}}).value.build('v0', rctx)
  assert(2, rctx.uniforms.length)
  assert(0, rctx.uniforms[0]) // lo defaulted
  assert(true, rctx.uniforms[1] === hiAst) // hi kept its AST, so it animates

  // The hashes: random rgb with the incoming alpha kept, as dot does. With no seed the shader gets
  // a literal rather than a uniform, so an unseeded hash is a fixed field and costs nothing to feed
  assert('vec4(l_pxhash(v0, vec4(0.0)).rgb, (v0).a)', emitted('pxhash', {value:node}))
  assert('vec4(l_pxhashf(v0, vec4(0.0)).rgb, (v0).a)', emitted('pxhashf', {value:node}))
  assert('vec4(l_pxhash(v0, u_vs0).rgb, (v0).a)', emitted('pxhash', {value:node, seed:2}))
  assert('vec4(l_pxhash(v0, u_vs0).rgb, (v0).a)', emitted('pxhash', {value:node, value1:2})) // Positional seed, as >>pxhash{2}
  assert('vec4(l_pxhashf(v0, u_vs0).rgb, (v0).a)', emitted('pxhashf', {value:node, seed:2}))

  // Each declares its own GLSL helper, and only when it is used
  let hctx = mockCtx()
  shaderAware('pxhash', numeric)({value:node}).value.build('v0', hctx)
  assert(['l_pxhash'], hctx.functions.map(f => f.name))
  hctx = mockCtx()
  shaderAware('pxhashf', numeric)({value:node}).value.build('v0', hctx)
  assert(['l_pxhashf'], hctx.functions.map(f => f.name))
  hctx = mockCtx()
  shaderAware('floor', numeric)({value:node}).value.build('v0', hctx)
  assert([], hctx.functions) // A function with no helpers declares none

  // A seed registers its raw AST, so it animates per frame like any other param
  let seedAst = () => 2
  hctx = mockCtx()
  shaderAware('pxhash', numeric)({value:node, seed:2, __rawArgs:{seed:seedAst}}).value.build('v0', hctx)
  assert(true, hctx.uniforms[0] === seedAst)

  // Off a visual node they are ordinary scalar functions
  assert('numeric', shaderAware('pxhash', numeric)({value:3}))
  assert('numeric', shaderAware('pxhashf', numeric)({value:3, seed:1}))

  // A non-node operand registers its raw AST, so it stays animated; the evalled value is only
  // used to decide whether it is a node
  let rawAst = () => 1/2
  let ctx = mockCtx()
  shaderAware('floor', numeric)({value:node, to:1/2, __rawArgs:{to:rawAst}}).value.build('v0', ctx)
  assert(true, ctx.uniforms[0] === rawAst)
  ctx = mockCtx()
  shaderAware('floor', numeric)({value:node, to:1/2}).value.build('v0', ctx) // No raw args: fall back to the value
  assert([1/2], ctx.uniforms)

  // A node anywhere in the args switches to GLSL; otherwise the numeric function is called
  assert('numeric', shaderAware('floor', numeric)({value:1.5}))
  assert('numeric', shaderAware('floor', numeric)({value:1.5, to:1/2}))
  assert('numeric', shaderAware('min', numeric)([1,2,3]))
  assert('numeric', shaderAware('min', numeric)(2))
  assert('numeric', shaderAware('min', numeric)(undefined))
  assert(true, shaderAware('min', numeric)({value:1, value1:node}).value.isShaderNode)
  assert(true, shaderAware('min', numeric)([1,node]).value.isShaderNode)

  // Flags on the wrapped function are preserved: they are read off the registered var function
  let agg = () => 0
  agg._isAggregator = true
  agg.interval = 'frame'
  assert(true, shaderAware('min', agg)._isAggregator)
  assert('frame', shaderAware('min', agg).interval)
  assert(true, shaderAware('min', agg).wantsRawArgs)

  console.log('Shader maths tests complete')
  }

  return {
    shaderAware: shaderAware,
    specs: specs,
  }
})
