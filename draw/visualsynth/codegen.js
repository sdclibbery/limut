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
      textures: [], // texture objects, parallel to sampler names u_vstex0, u_vstex1...
      notReady: false, // a texture source isn't available yet (eg webcam pre-enumeration)
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
    ctx.addTexture = (tex) => {
      if (tex === undefined) { ctx.notReady = true }
      let name = 'u_vstex' + ctx.textures.length
      ctx.textures.push(tex)
      return name
    }
    return ctx
  }

  // The generated shader is self-contained: no common processors, no pre/postprocess —
  // the px chain IS the shader. Each pixel starts as its own coordinate in v0.
  let buildSource = (shaderNode) => {
    let ctx = makeContext()
    let out = shaderNode.build('v0', ctx)
    let source = `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform vec2 l_extents;
${ctx.uniforms.map(u => `uniform vec4 ${u.name};`).join('\n')}
${ctx.textures.map((t,i) => `uniform sampler2D u_vstex${i};`).join('\n')}
void main() {
  vec4 v0 = vec4(fragCoord, 0.0, 1.0);
  ${ctx.statements.join('\n  ')}
  fragColor = ${out};
}`
    return { source: source, uniforms: ctx.uniforms, textures: ctx.textures, notReady: ctx.notReady }
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
  assert(true, built.textures[0] === stubTex)

  // Same chain built twice yields byte-identical source: the program cache key property
  let rebuilt = buildSource(chain)
  assert(true, built.source === rebuilt.source)

  // Undefined texture flags notReady
  let notReady = buildSource(texNode(undefined))
  assert(true, notReady.notReady)

  // No textures => no sampler declarations
  let noTex = buildSource(mulNode(ast))
  assert(false, noTex.source.includes('sampler2D'))
  assert(0, noTex.textures.length)

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
