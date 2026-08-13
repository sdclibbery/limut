'use strict'
define(function(require) {
  let {getCallTree} = require('player/callstack')

  // Builds the fragment shader source for a visual synth px chain. All generated names come
  // from per-context counters assigned during a single left-to-right build walk, so the same
  // px expression always generates byte-identical source — the program cache key.
  let makeContext = () => {
    let ctx = {
      statements: [],
      uniforms: [], // {name, ast, callTree} — ast is the raw unevaluated arg, re-evaluated per frame
      textures: [], // {texture, sampler} entries, parallel to sampler names u_vstex0, u_vstex1...
      functions: [], // {name, source} GLSL helper declarations, emitted before main
      notReady: false, // a texture source isn't available yet (eg webcam pre-enumeration)
      built: new Map(), // node -> Map(input -> varName): emit each node once, see makeShaderNode
    }
    let nextVar = 1 // v0 is the implicit uv seed
    ctx.addStatement = (expr) => {
      let name = 'v' + (nextVar++)
      ctx.statements.push(`vec4 ${name} = ${expr};`)
      return name
    }
    ctx.addRaw = (stmt) => { ctx.statements.push(stmt) }
    ctx.addUniform = (ast) => {
      let name = 'u_vs' + ctx.uniforms.length
      // The call tree current during this node's build is the one the AST was written in, so keep
      // it: the per frame eval in draw/visualsynth.js has to restore it to resolve lambda args
      ctx.uniforms.push({name: name, ast: ast, callTree: getCallTree()})
      return name
    }
    // A GLSL helper function declared before main, for a node whose emitted expression is more than
    // one line of maths (eg the pxhash hashes). Deduped by name, so a chain using the same node
    // several times declares it once. Names are fixed literals rather than counters, and the l_
    // prefix keeps them clear of the generated vN/u_vsN/uvN names.
    ctx.addFunction = (name, source) => {
      if (!ctx.functions.some(f => f.name === name)) { ctx.functions.push({name: name, source: source}) }
      return name
    }
    // Each texture gets its own sampler and its own extents uniform (u_vsexN): one shared
    // l_extents cannot serve several textures, and a lut texture wants no aspect correction at all
    ctx.addTexture = (tex, sampler) => {
      if (tex === undefined) { ctx.notReady = true }
      let name = 'u_vstex' + ctx.textures.length
      ctx.textures.push({texture: tex, sampler: sampler || 'sampler2D'})
      return name
    }
    return ctx
  }

  // The generated shader is self-contained: no common processors, no pre/postprocess —
  // the px chain IS the shader. Each pixel starts as its own coordinate in v0.
  let buildSource = (shaderNode) => {
    let ctx = makeContext()
    let out = shaderNode.build('v0', ctx)
    // GLSL ES 3.00 has a default precision for sampler2D but not sampler3D, so a 3d lookup
    // texture has to declare one or the shader won't compile
    let sampler3d = ctx.textures.some(t => t.sampler === 'sampler3D')
    let source = `#version 300 es
precision highp float;
${sampler3d ? 'precision highp sampler3D;\n' : ''}in vec2 fragCoord;
out vec4 fragColor;
${ctx.uniforms.map(u => `uniform vec4 ${u.name};`).join('\n')}
${ctx.textures.map((t,i) => `uniform ${t.sampler} u_vstex${i};\nuniform vec2 u_vsex${i};`).join('\n')}
${ctx.functions.map(f => f.source).join('\n')}
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  ${ctx.statements.join('\n  ')}
  fragColor = ${out};
}`
    return { source: source, uniforms: ctx.uniforms, textures: ctx.textures, functions: ctx.functions, notReady: ctx.notReady }
  }

  // TESTS //
  if ((new URLSearchParams(window.location.search)).get('test') !== null) {

  let assert = (expected, actual) => {
    let x = JSON.stringify(expected)
    let a = JSON.stringify(actual)
    if (x !== a) { console.trace(`Assertion failed.\n>>Expected:\n  ${x}\n>>Actual:\n  ${a}`) }
  }
  let {makeShaderNode, composeShaderNodes, binaryShaderNode} = require('draw/visualsynth/shader-node')

  let mulNode = (ast) => makeShaderNode((input, ctx) => ctx.addStatement(`${input} * ${ctx.addUniform(ast)}`))
  let addNode = (ast) => makeShaderNode((input, ctx) => ctx.addStatement(`${input} + ${ctx.addUniform(ast)}`))
  let texNode = (t) => makeShaderNode((input, ctx) => {
    let sampler = ctx.addTexture(t)
    return ctx.addStatement(`texture(${sampler}, (${input}).xy)`)
  })

  let ast = () => 0.5
  let stubTex = {tex:'stub'}
  let chain = composeShaderNodes(mulNode(ast), texNode(stubTex))
  let built = buildSource(chain)
  assert(true, built.source.includes('vec4 v1 = v0 * u_vs0;'))
  assert(true, built.source.includes('vec4 v2 = texture(u_vstex0, (v1).xy);'))
  assert(true, built.source.indexOf('v0 * u_vs0') < built.source.indexOf('texture(u_vstex0')) // chain order
  assert(true, built.source.includes('fragColor = v2;'))
  assert(true, built.source.includes('uniform vec4 u_vs0;'))
  assert(true, built.source.includes('uniform sampler2D u_vstex0;'))
  // Raw shader: the px chain is the whole shader, no common processing
  assert(false, built.source.includes('preprocess'))
  assert(false, built.source.includes('postprocess'))
  assert(false, built.notReady)
  assert('u_vs0', built.uniforms[0].name)
  assert(true, built.uniforms[0].ast === ast)
  assert(true, built.textures[0].texture === stubTex)
  assert('sampler2D', built.textures[0].sampler)
  assert(true, built.source.includes('uniform vec2 u_vsex0;')) // Per texture extents, not one shared l_extents
  assert(false, built.source.includes('l_extents'))

  // Same chain built twice yields byte-identical source: the program cache key property
  let rebuilt = buildSource(chain)
  assert(true, built.source === rebuilt.source)

  // A node reached twice emits once and registers its uniform once, so a value reused several
  // times (a lambda arg, as smooth noise does) costs what using it once costs
  let shared = mulNode(ast)
  let reused = buildSource(binaryShaderNode((a,b) => `${a} + ${b}`, undefined, shared, undefined, shared))
  assert(1, (reused.source.match(/v0 \* u_vs0/g) || []).length)
  assert(1, reused.uniforms.length)
  assert(true, reused.source.includes('vec4 v2 = v1 + v1;'))

  // Undefined texture flags notReady
  let notReady = buildSource(texNode(undefined))
  assert(true, notReady.notReady)

  // No textures => no sampler declarations
  let noTex = buildSource(mulNode(ast))
  assert(false, noTex.source.includes('sampler2D'))
  assert(0, noTex.textures.length)

  // Several textures in one chain each get their own sampler slot and extents uniform
  let stubTex2 = {tex:'stub2'}
  let twoTex = buildSource(composeShaderNodes(texNode(stubTex), texNode(stubTex2)))
  assert(true, twoTex.source.includes('uniform sampler2D u_vstex0;'))
  assert(true, twoTex.source.includes('uniform sampler2D u_vstex1;'))
  assert(true, twoTex.source.includes('uniform vec2 u_vsex0;'))
  assert(true, twoTex.source.includes('uniform vec2 u_vsex1;'))
  assert(2, twoTex.textures.length)
  assert(true, twoTex.textures[1].texture === stubTex2)

  // A 3d lookup texture declares a sampler3D
  let tex3dNode = makeShaderNode((input, ctx) => {
    let sampler = ctx.addTexture(stubTex, 'sampler3D')
    return ctx.addStatement(`texture(${sampler}, (${input}).xyz)`)
  })
  let built3d = buildSource(tex3dNode)
  assert(true, built3d.source.includes('uniform sampler3D u_vstex0;'))
  assert('sampler3D', built3d.textures[0].sampler)
  assert(true, built3d.source.includes('precision highp sampler3D;')) // No default precision for it in GLSL ES 3.00
  assert(false, built.source.includes('precision highp sampler3D;')) // Only declared where it is needed

  // Helper functions: declared once each, before main, whatever the chain does with them
  let helperNode = (name) => makeShaderNode((input, ctx) => {
    ctx.addFunction(name, `vec4 ${name}(vec4 p) { return p; }`)
    return ctx.addStatement(`${name}(${input})`)
  })
  let helped = buildSource(helperNode('l_stub'))
  assert(true, helped.source.includes('vec4 l_stub(vec4 p) { return p; }'))
  assert(true, helped.source.indexOf('vec4 l_stub(vec4 p)') < helped.source.indexOf('void main()')) // Declared before it is called
  assert(1, helped.functions.length)
  assert('l_stub', helped.functions[0].name)

  // Declarations land after the uniforms, so a helper could refer to one
  let withUniform = buildSource(composeShaderNodes(mulNode(ast), helperNode('l_stub')))
  assert(true, withUniform.source.indexOf('uniform vec4 u_vs0;') < withUniform.source.indexOf('vec4 l_stub(vec4 p)'))

  // The same helper used twice is declared once: dedupe is by name
  let twice = buildSource(composeShaderNodes(helperNode('l_stub'), helperNode('l_stub')))
  assert(1, (twice.source.match(/vec4 l_stub\(vec4 p\)/g) || []).length)
  assert(1, twice.functions.length)
  assert(2, (twice.source.match(/l_stub\(v\d+\)/g) || []).length) // But called twice

  // Two different helpers both get declared, in build order
  let two = buildSource(composeShaderNodes(helperNode('l_a'), helperNode('l_b')))
  assert(['l_a','l_b'], two.functions.map(f => f.name))
  assert(true, two.source.indexOf('vec4 l_a(') < two.source.indexOf('vec4 l_b('))
  assert(true, two.source === buildSource(composeShaderNodes(helperNode('l_a'), helperNode('l_b'))).source) // Still byte-identical

  // A chain that declares none has none
  assert(0, buildSource(mulNode(ast)).functions.length)

  // A mul then an add stage, shaped like px=mul{2}>>add{0.5}>>tex{...}
  let offsetAst = () => 0.5
  let offsetChain = composeShaderNodes(composeShaderNodes(mulNode(ast), addNode(offsetAst)), texNode(stubTex))
  let offsetBuilt = buildSource(offsetChain)
  assert(true, offsetBuilt.source.includes('vec4 v1 = v0 * u_vs0;'))
  assert(true, offsetBuilt.source.includes('vec4 v2 = v1 + u_vs1;')) // Consumes the mul's output
  assert(true, offsetBuilt.source.includes('vec4 v3 = texture(u_vstex0, (v2).xy);'))
  assert(true, offsetBuilt.uniforms[1].ast === offsetAst) // Raw AST, so the offset stays animatable
  assert(true, offsetBuilt.source === buildSource(offsetChain).source) // byte-identical: cache key

  // Operators on nodes, shaped like px=mul{1}/2+#080
  let twoAst = () => 2
  let colAst = {r:0,g:0.5,b:0,a:1}
  let arith = binaryShaderNode((a,b) => `${a} + ${b}`,
    undefined, binaryShaderNode((a,b) => `${a} / ${b}`, undefined, mulNode(ast), twoAst, 2),
    colAst, colAst)
  let arithBuilt = buildSource(arith)
  assert(true, arithBuilt.source.includes('vec4 v1 = v0 * u_vs0;'))
  assert(true, arithBuilt.source.includes('vec4 v2 = v1 / u_vs1;'))
  assert(true, arithBuilt.source.includes('vec4 v3 = v2 + u_vs2;'))
  assert(true, arithBuilt.source.includes('fragColor = v3;'))
  assert(3, arithBuilt.uniforms.length)
  assert(true, arithBuilt.uniforms[1].ast === twoAst) // raw ASTs, re-evaluated per frame
  assert(true, arithBuilt.uniforms[2].ast === colAst)
  assert(true, arithBuilt.source === buildSource(arith).source) // still byte-identical: cache key

  // Maths functions, shaped like px=id>>floor{1/40}>>tex{...}
  let {shaderAware} = require('draw/visualsynth/shader-maths')
  let idNode = makeShaderNode((input, ctx) => ctx.addStatement(input))
  let toAst = () => 1/40
  let quantised = shaderAware('floor', () => 0)({value:idNode, value1:1/40, __rawArgs:{value1:toAst}}).value
  let mathsChain = composeShaderNodes(quantised, texNode(stubTex))
  let mathsBuilt = buildSource(mathsChain)
  assert(true, mathsBuilt.source.includes('vec4 v1 = v0;'))
  assert(true, mathsBuilt.source.includes('vec4 v2 = floor(v1 / u_vs0) * u_vs0;'))
  assert(true, mathsBuilt.source.includes('vec4 v3 = texture(u_vstex0, (v2).xy);'))
  assert(true, mathsBuilt.uniforms[0].ast === toAst) // raw AST, so the precision stays animatable
  assert(true, mathsBuilt.source === buildSource(mathsChain).source) // byte-identical: cache key

  console.log('Visual synth codegen tests complete')
  }

  return {
    makeContext: makeContext,
    buildSource: buildSource,
  }
})
