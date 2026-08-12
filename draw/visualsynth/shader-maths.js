'use strict'
define(function(require) {
  let {isShaderNode,naryShaderNode} = require('draw/visualsynth/shader-node')
  let {pcg4dHelper,hash44Helper,hashSpec} = require('draw/visualsynth/shader-hash')

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

  // value, plus an optional precision to quantise to: named as `to`, or the second positional arg
  // (which is where `>>floor{1/40}` puts it once the piped value has taken the first slot)
  let quantiseOperands = (args, raw) => {
    let ops = mainOperand(args, raw)
    let to = operand(args, raw, 'to') || operand(args, raw, 'value1')
    if (to !== undefined) { ops.push(to) }
    return ops
  }

  // value, plus an optional seed: named as `seed`, or the second positional arg (which is where
  // `>>pxhash{2}` puts it once the piped value has taken the first slot), as `to` works for floor
  let seedOperands = (args, raw) => {
    let ops = mainOperand(args, raw)
    let seed = operand(args, raw, 'seed') || operand(args, raw, 'value1')
    if (seed !== undefined) { ops.push(seed) }
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
  // Dot product of the rgb components, splatted back into rgb with the input's alpha kept, so a
  // monochrome chain (dot{id,#3b1}) comes out opaque rather than see through. One arg dots with itself.
  let dot = {
    emit: (a, b) => `vec4(vec3(dot((${a}).rgb, (${b === undefined ? a : b}).rgb)), (${a}).a)`,
    operands: (args, raw) => {
      let ops = mainOperand(args, raw)
      let b = operand(args, raw, 'value1')
      if (b !== undefined) { ops.push(b) }
      return ops
    },
  }

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
    atan: unary('atan'),
    min: variadic('min'),
    max: variadic('max'),
    dot: dot,
    pxhash: hash(pcg4dHelper),
    pxhashf: hash(hash44Helper),
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
