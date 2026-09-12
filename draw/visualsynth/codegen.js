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
      lets: {}, // name -> the GLSL variable holding a let bound value, filled during the build walk
      // key -> the name of the GLSL function declared for that px sub-chain (pxfn{}, see
      // draw/visualsynth/shader-function.js). Deliberately NOT saved and restored by a captured
      // block: a function is declared at file scope, so one first declared inside a loop body is
      // still callable after the closing brace, exactly as a uniform slot is.
      pxFunctions: new Map(),
    }
    // v0 is the implicit uv seed: the value the whole chain starts with. It stays in scope for the
    // whole shader — which is what lets the uv node (nodes.js) name it from anywhere in the chain.
    // Ordinarily it is a local of main(), since every generated statement lands in main(); a shader
    // that declares a px function (pxfn{}) hoists it to file scope instead, because a function body
    // is a scope of its own and main's locals are not visible in it. See needsGlobalSeed below.
    ctx.rootInput = 'v0'
    let nextVar = 1
    ctx.addStatement = (expr) => {
      let name = 'v' + (nextVar++)
      ctx.statements.push(`vec4 ${name} = ${expr};`)
      return name
    }
    ctx.addRaw = (stmt) => { ctx.statements.push(stmt) }
    // A real GLSL for loop (loop{} in a px chain, see shader-repeat.js) needs its body's statements
    // wrapped in a block rather than landing in main() alongside everything else. Statements emitted
    // while fn runs are captured and handed back for the caller to indent into the block.
    //
    // ctx.built is saved and restored around it, deep copied because its values are Maps: outer
    // entries stay visible inside the block, which is right (an outer vN is in scope in a nested
    // block), but an entry made *inside* must not survive it, or a later build would reuse a
    // variable that has gone out of scope. ctx.lets is copied for exactly the same reason: a
    // let{} inside the body names a variable that goes out of scope at the closing brace.
    // nextVar keeps counting across the block, so every generated name is still unique and still
    // comes from a counter: the source must stay deterministic, since the program cache is keyed on it.
    //
    // isolate is the difference between a block and a function body (captureFunction below): a
    // block's enclosing variables are still in scope inside it, where a function's are not, so a
    // function body starts with an empty built map and no let bindings rather than copies of the
    // outer ones. Everything else — the capture itself, the restore, the shared nextVar — is the same.
    let capture = (fn, isolate) => {
      let outerStatements = ctx.statements
      let outerBuilt = ctx.built
      let outerLets = ctx.lets
      ctx.statements = []
      ctx.built = isolate ? new Map() : new Map(Array.from(outerBuilt, ([node, byInput]) => [node, new Map(byInput)]))
      ctx.lets = isolate ? {} : Object.assign({}, outerLets)
      let out, statements
      try {
        out = fn()
      } finally {
        statements = ctx.statements
        ctx.statements = outerStatements
        ctx.built = outerBuilt
        ctx.lets = outerLets
      }
      return {out: out, statements: statements}
    }
    ctx.captureBlock = (fn) => capture(fn, false)
    // The body of a real GLSL function (pxfn{} in a px chain, see shader-function.js). Isolated as
    // above, because a function body cannot see the enclosing scope: a function is declared once
    // with fixed parameters, so anything it captured would have to be one of them, and the same
    // sub-chain called from two places with two different environments could not then share a
    // declaration. What it can still reach is what lives at file scope — uniforms, samplers, the
    // helper functions, and the seed, which is why declaring one hoists v0 out of main().
    ctx.captureFunction = (fn) => {
      ctx.needsGlobalSeed = true
      return capture(fn, true)
    }
    // The counter variable of a for loop. Same l_ prefix as the helper functions, keeping it clear
    // of the generated vN/u_vsN/uvN names.
    let nextLoopVar = 0
    ctx.loopVar = () => 'l_i' + (nextLoopVar++)
    // A declared function and its parameter, both named from one counter so the pair always agree.
    // Same l_ prefix as the loop counters and the helper functions, keeping them clear of the
    // generated vN/u_vsN/uvN names, and from a counter for the usual reason: the program cache (and
    // the source stability check in draw/visualsynth.js) is keyed on the source text.
    let nextFunction = 0
    ctx.functionName = () => {
      let i = nextFunction++
      return {name: 'l_fn' + i, param: 'l_p' + i}
    }
    // Two uniform slots may share a name when the expression that feeds them is the same one in the
    // same scope: it then holds the same value on every frame, animated or not, so a second slot is
    // pure waste - a `uniform vec4` line in the source, an evalParamFrame every frame
    // (draw/visualsynth.js), and 16 bytes a frame on the wire for a display bound chain
    // (draw/hub75/host/hub75.js). Without this the Fire chain (examples.limut) shipped 83 uniforms
    // where 28 do: 32 of them were the one `seed` that lib/visual.limut's noise stack threads down
    // into every octave's every face's every hash, and 28 more were four lattice offset literals,
    // re-registered once per instantiation.
    //
    // Deliberately keyed on where a value comes from and NOT on what it evaluates to, and
    // deliberately not folded into the source as a GLSL literal. Either of those would make the
    // grouping depend on the numbers, so nudging mul{2} to mul{3} while playing would move the
    // generated source and force a shader compile on the beat - the exact cost the source-stability
    // check at the top of draw/visualsynth.js exists to catch. Provenance keying leaves the source
    // alone under a numeric edit.
    //
    // Two things are dedupable:
    //  - an object literal (a parsed map whose leaves are all numbers or strings). It cannot read
    //    the call context, so it means the same thing wherever it is reached, and the one parsed
    //    instance reached N times is keyed by its own identity. This is the lattice offsets.
    //  - a lookup that can name its binding (expression/parse-var.js), keyed on the {ast, context}
    //    pair it resolves to. This is `seed`: all 32 resolve to the one default bound in the one
    //    fbm3 frame. A bare number as the *resolved* root takes part by value - it is a literal, so
    //    it is constant - but a bare number written directly as a uniform's AST does not, which is
    //    what keeps mul{2} and add{2} on separate uniforms and out of the churn above.
    // Anything else gets a slot of its own, exactly as before.
    let isObjectLiteral = (v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) { return false }
      for (let k in v) {
        let x = v[k]
        if (typeof x === 'function') { return false }
        if (typeof x === 'object' && x !== null && !isObjectLiteral(x)) { return false }
      }
      return true
    }
    // ast -> Map(context -> name). Two levels rather than one composite key, because both halves
    // are object identities as often as they are values, and `undefined` is a legitimate context
    // (a binding resolved at the top level, outside any call).
    let uniformNames = new Map()
    let uniformKey = (ast) => {
      if (isObjectLiteral(ast)) { return {ast: ast, context: null} }
      if (typeof ast === 'function' && ast._bindingSource !== undefined) { return ast._bindingSource() }
      return undefined
    }
    ctx.addUniform = (ast) => {
      // Called from inside a node's build, so the call tree is already the one the AST was written
      // in - which is exactly the scope the binding has to be resolved in
      let key = uniformKey(ast)
      let byContext
      if (key !== undefined) {
        byContext = uniformNames.get(key.ast)
        if (byContext !== undefined && byContext.has(key.context)) { return byContext.get(key.context) }
      }
      let name = 'u_vs' + ctx.uniforms.length
      // The call tree current during this node's build is the one the AST was written in, so keep
      // it: the per frame eval in draw/visualsynth.js has to restore it to resolve lambda args
      ctx.uniforms.push({name: name, ast: ast, callTree: getCallTree()})
      if (key !== undefined) {
        if (byContext === undefined) { byContext = new Map(); uniformNames.set(key.ast, byContext) }
        byContext.set(key.context, name)
      }
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
    let out = shaderNode.build(ctx.rootInput, ctx)
    // GLSL ES 3.00 has a default precision for sampler2D but not sampler3D, so a 3d lookup
    // texture has to declare one or the shader won't compile
    let sampler3d = ctx.textures.some(t => t.sampler === 'sampler3D')
    // A px function's body is a scope of its own, so main's locals are not visible in it — and the
    // seed is one of them, which the uv node names from anywhere in the chain. So a shader that
    // declares one hoists the seed to file scope, declared before the functions and assigned as
    // main's first line. Conditional, like the sampler3D precision above: a shader with no function
    // in it then generates byte-identical source to before, which keeps the program cache and the
    // hub75 layer keys (draw/hub75/host/hub75.js, keyed on the source text) undisturbed.
    let globalSeed = ctx.needsGlobalSeed === true
    let source = `#version 300 es
precision highp float;
${sampler3d ? 'precision highp sampler3D;\n' : ''}in vec2 fragCoord;
out vec4 fragColor;
${ctx.uniforms.map(u => `uniform vec4 ${u.name};`).join('\n')}
${ctx.textures.map((t,i) => `uniform ${t.sampler} u_vstex${i};\nuniform vec2 u_vsex${i};`).join('\n')}
${globalSeed ? `vec4 ${ctx.rootInput};\n` : ''}${ctx.functions.map(f => f.source).join('\n')}
void main() {
  ${globalSeed ? '' : 'vec4 '}${ctx.rootInput} = vec4(fragCoord, 0.0, 1.0);
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

  // The seed variable is named on the context, so a node can refer to it from anywhere in the
  // chain (the uv node, nodes.js) rather than hard coding it
  assert('v0', makeContext().rootInput)

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

  // captureBlock: statements emitted while it runs are captured for the caller to wrap in a block,
  // rather than landing in main() (see loopShaderNode in shader-repeat.js)
  let blockCtx = makeContext()
  blockCtx.addStatement('outer')
  let block = blockCtx.captureBlock(() => blockCtx.addStatement('inner'))
  assert('v2', block.out)
  assert(['vec4 v2 = inner;'], block.statements) // Captured, not in main
  assert(['vec4 v1 = outer;'], blockCtx.statements) // main is untouched by it
  assert('v3', blockCtx.addStatement('after')) // The variable counter carries on across the block

  // The emit-once map is restored afterwards, so a node built inside the block is emitted again
  // outside it: its variable has gone out of scope by then. Entries made before it stay visible.
  let blockNode = makeShaderNode((input, ctx) => ctx.addStatement(`b(${input})`))
  blockCtx = makeContext()
  blockNode.build('v0', blockCtx)
  blockCtx.captureBlock(() => { blockNode.build('v0', blockCtx); blockNode.build('v9', blockCtx) })
  blockNode.build('v9', blockCtx)
  assert(['vec4 v1 = b(v0);', 'vec4 v3 = b(v9);'], blockCtx.statements) // v0 reused inside, v9 not reused after
  assert(1, blockCtx.built.size)

  blockCtx = makeContext() // It restores even when the build throws
  try { blockCtx.captureBlock(() => { throw 'x' }) } catch (err) {}
  blockCtx.addStatement('after')
  assert(['vec4 v1 = after;'], blockCtx.statements)

  // captureFunction is captureBlock with the enclosing scope withheld: a function body cannot see
  // main's variables or its let bindings, so it starts with neither rather than with copies
  let fnCtx = makeContext()
  fnCtx.addStatement('outer')
  fnCtx.lets.d = 'v1'
  blockNode.build('v1', fnCtx)
  let fnBlock = fnCtx.captureFunction(() => {
    assert({}, fnCtx.lets) // No outer bindings
    fnCtx.lets.inner = 'v9'
    return blockNode.build('v1', fnCtx) // Emitted again: the outer v2 is not in scope in here
  })
  assert(['vec4 v3 = b(v1);'], fnBlock.statements)
  assert(['vec4 v1 = outer;', 'vec4 v2 = b(v1);'], fnCtx.statements) // main is untouched by it
  assert(['d'], Object.keys(fnCtx.lets)) // and the outer bindings are put back, without the inner one
  assert('v4', fnCtx.addStatement('after')) // The variable counter carries on across it, as for a block
  assert(true, fnCtx.needsGlobalSeed) // Declaring a function hoists the seed out of main()

  fnCtx = makeContext() // It restores even when the build throws
  try { fnCtx.captureFunction(() => { throw 'x' }) } catch (err) {}
  fnCtx.addStatement('after')
  assert(['vec4 v1 = after;'], fnCtx.statements)

  // Function and parameter names come from one counter, so the pair always agree, and per context
  let nameCtx = makeContext()
  assert([{name:'l_fn0',param:'l_p0'},{name:'l_fn1',param:'l_p1'}], [nameCtx.functionName(), nameCtx.functionName()])
  assert({name:'l_fn0',param:'l_p0'}, makeContext().functionName())

  // The seed is hoisted to file scope only for a shader that declares a function: a function body
  // is a scope of its own and main's locals are not visible in it, but every shader without one
  // must keep generating exactly the source it always did (the program cache and hub75 layer keys)
  let seedCtx = makeContext()
  let hoisted = buildSource(makeShaderNode((input, ctx2) => {
    ctx2.captureFunction(() => 'x')
    return ctx2.addStatement(`f(${input})`)
  }))
  assert(true, hoisted.source.includes('\nvec4 v0;\n')) // Declared before the function declarations
  assert(true, hoisted.source.includes('void main() {\n  v0 = vec4(fragCoord, 0.0, 1.0);')) // Assigned, not redeclared
  assert(undefined, seedCtx.needsGlobalSeed) // A context that never declares one never sets it
  assert(true, buildSource(mulNode(ast)).source.includes('void main() {\n  vec4 v0 = vec4(fragCoord, 0.0, 1.0);'))

  // A function declaration is at file scope, so the registry that dedupes it is not block scoped
  // (unlike ctx.built and ctx.lets above): one declared inside a loop body is still callable after it
  let regCtx = makeContext()
  let regKey = {}
  regCtx.captureBlock(() => regCtx.pxFunctions.set(regKey, 'l_fn0'))
  assert('l_fn0', regCtx.pxFunctions.get(regKey))

  // Loop counter names come from a counter of their own, so they stay deterministic
  let loopCtx = makeContext()
  assert(['l_i0', 'l_i1'], [loopCtx.loopVar(), loopCtx.loopVar()])
  assert('l_i0', makeContext().loopVar()) // Per context, like every other generated name

  // A whole shader with a block in it, shaped like px=loop{mul{2}, 4}. The loop node itself lives
  // in shader-repeat.js; it is written out here rather than required, to keep this file's tests
  // free of a circular dependency on it (its own tests build on makeContext).
  let loopNode = (body, count) => makeShaderNode((input, ctx) => {
    let acc = ctx.addStatement(input)
    let name = ctx.loopVar()
    let inner = ctx.captureBlock(() => body.build(acc, ctx))
    ctx.addRaw(`for (int ${name} = 0; ${name} < ${count}; ${name}++) {`)
    inner.statements.forEach(st => ctx.addRaw('  ' + st))
    ctx.addRaw(`  ${acc} = ${inner.out};`)
    ctx.addRaw('}')
    return acc
  })
  let looped = composeShaderNodes(loopNode(mulNode(ast), 4), texNode(stubTex))
  let loopBuilt = buildSource(looped)
  assert(true, loopBuilt.source.includes('  vec4 v1 = v0;\n  for (int l_i0 = 0; l_i0 < 4; l_i0++) {\n    vec4 v2 = v1 * u_vs0;\n    v1 = v2;\n  }'))
  assert(true, loopBuilt.source.includes('vec4 v3 = texture(u_vstex0, (v1).xy);')) // The chain carries on from the accumulator
  assert(1, loopBuilt.uniforms.length) // The body is emitted once, so its uniform is registered once
  assert(true, loopBuilt.source === buildSource(looped).source) // still byte-identical: cache key

  // Uniform sharing. Two slots may hold one name when the expression feeding them is the same one
  // in the same scope, because it then holds the same value on every frame. See addUniform: keyed
  // on where a value comes from, never on what it evaluates to.
  let dctx = makeContext()
  let offset = {x:1, w:0}
  assert('u_vs0', dctx.addUniform(offset))
  assert('u_vs0', dctx.addUniform(offset)) // The one parsed literal reached twice costs one slot
  assert('u_vs1', dctx.addUniform({x:1, w:0})) // A distinct literal of equal value does not: sharing is by identity
  assert('u_vs2', dctx.addUniform({x:1, y:{z:2}})) // Nested literals count as literal too
  assert(3, dctx.uniforms.length)
  assert('u_vs3', dctx.addUniform(2)) // A bare number written straight into a uniform is never shared,
  assert('u_vs4', dctx.addUniform(2)) // so mul{2}>>add{2} cannot merge and then split again on an edit
  let notLiteral = {x: () => 1} // An expression inside the map can read the call context
  assert('u_vs5', dctx.addUniform(notLiteral))
  assert('u_vs6', dctx.addUniform(notLiteral))
  assert(7, dctx.uniforms.length)
  assert(true, dctx.uniforms[0].ast === offset) // The raw AST is still what gets registered
  assert(true, dctx.uniforms.every((u,i) => u.name === 'u_vs'+i)) // Names still come from the counter

  // A lookup that can name its binding (expression/parse-var.js) is keyed on what it resolves to
  let lookupTo = (ast, context) => { let f = () => 0; f._bindingSource = () => ({ast:ast, context:context}); return f }
  let bctx = makeContext()
  let binding = () => 0
  let frame = {}
  assert('u_vs0', bctx.addUniform(lookupTo(binding, frame)))
  assert('u_vs0', bctx.addUniform(lookupTo(binding, frame))) // Different lookups, one binding: one slot
  assert('u_vs1', bctx.addUniform(lookupTo(binding, {}))) // The same expression in another frame is another value
  assert('u_vs2', bctx.addUniform(lookupTo(() => 0, frame))) // and another expression in the same frame
  assert(3, bctx.uniforms.length)
  let unresolved = () => 0
  unresolved._bindingSource = () => undefined
  assert('u_vs3', bctx.addUniform(unresolved)) // Nothing to name: a slot of its own, as before
  assert('u_vs4', bctx.addUniform(unresolved))

  // A binding that resolves to a bare number takes part by value - a literal is constant. This is
  // the case that matters: fbm3's `seed` defaults to 0, and all 32 of its references resolve to
  // that one default in that one frame.
  let cctx = makeContext()
  assert('u_vs0', cctx.addUniform(lookupTo(0, undefined)))
  assert('u_vs0', cctx.addUniform(lookupTo(0, undefined)))
  assert('u_vs1', cctx.addUniform(lookupTo(1, undefined)))
  assert(2, cctx.uniforms.length)

  // Sharing survives a captured block, unlike the emit-once map above it: uniforms are declared at
  // file scope, so a slot registered inside a loop body is still in scope after the closing brace
  let lctx = makeContext()
  let blockOffset = {x:1}
  lctx.captureBlock(() => lctx.addUniform(blockOffset))
  assert('u_vs0', lctx.addUniform(blockOffset))
  assert(1, lctx.uniforms.length)

  // Sharing is per context, like every other generated name
  assert('u_vs0', makeContext().addUniform(offset))

  console.log('Visual synth codegen tests complete')
  }

  return {
    makeContext: makeContext,
    buildSource: buildSource,
  }
})
