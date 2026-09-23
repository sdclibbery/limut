'use strict'
define(function(require) {
  let {getCallTree,getCallTreeString} = require('player/callstack')
  let {toVec4} = require('draw/visualsynth/shader-node')

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
      // name -> the GLSL variable of a loop{} carried value (carry:, see shader-repeat.js). A let{}
      // on one of these names assigns the variable in place rather than naming a new one, which is
      // what makes it survive an iteration and stay readable after the loop. Saved and restored by a
      // captured block in lockstep with lets, for the same reason: a carried value declared inside a
      // block goes out of scope with it.
      carried: {},
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
    // Common subexpression elimination: a statement whose expression text is already emitted in
    // scope reuses that variable. Generated expressions are pure, so equal text means equal value
    // unless something it reads has since been assigned (addRaw handles that). This catches values
    // reached by several routes as distinct node objects, which ctx.built cannot. It relies on
    // constants being literals (addUniform), since two uniform slots would never read the same.
    //
    // fresh is for a variable that will be assigned to (loop carry, fold total): it must never be
    // shared with or reused by another expression.
    ctx.exprs = new Map() // canonical expression text -> the variable holding it
    // A copy (vec4 v1 = v0;, which a pass-through emits) holds the same value as what it copied, so
    // expressions are looked up with each copy replaced by the variable it is a copy of: otherwise
    // everything computed from v1 would miss everything computed from v0. The copy itself is still
    // emitted, which keeps the source of a chain with no repeats in it exactly what it always was.
    ctx.aliases = new Map() // copy -> the variable it is a copy of
    let identifier = /\b[A-Za-z_]\w*\b/g
    let canonical = (expr) => expr.replace(identifier, (id) => ctx.aliases.has(id) ? ctx.aliases.get(id) : id)
    ctx.addStatement = (expr, fresh) => {
      let key = canonical(expr)
      if (!fresh) {
        let existing = ctx.exprs.get(key)
        if (existing !== undefined) { return existing }
      }
      let name = 'v' + (nextVar++)
      ctx.statements.push(`vec4 ${name} = ${expr};`)
      if (!fresh) {
        if (/^[A-Za-z_]\w*$/.test(key)) { ctx.aliases.set(name, key) }
        else { ctx.exprs.set(key, name) }
      }
      return name
    }
    // A raw statement may assign to a variable (a loop write-back, a fold, a carried let), after
    // which any remembered expression reading it no longer holds what the same text would now
    // compute, and a copy of it or by it no longer holds the same value, so those are forgotten.
    // Declarations match too (vec2 uv0 = ...), harmlessly: nothing remembered can read a variable
    // that is only now being declared.
    let assigned = /\b([A-Za-z_]\w*)(?:\.\w+)?\s*[-+*\/]?=(?!=)/g
    ctx.addRaw = (stmt) => {
      ctx.statements.push(stmt)
      let m
      assigned.lastIndex = 0
      while ((m = assigned.exec(stmt)) !== null) {
        let target = m[1]
        let reads = new RegExp('\\b' + target + '\\b')
        for (let [key, name] of ctx.exprs) {
          if (name === target || reads.test(key)) { ctx.exprs.delete(key) }
        }
        for (let [copy, of] of ctx.aliases) {
          if (copy === target || of === target) { ctx.aliases.delete(copy) }
        }
      }
    }
    // Capture the statements emitted while fn runs, for a GLSL loop{} block (shader-repeat.js).
    //
    // ctx.built, ctx.lets and ctx.carried are deep copied and restored: outer entries stay visible
    // inside the block, but entries made inside must not outlive it, or a later build would reuse a
    // variable that is out of scope. nextVar keeps counting so names stay unique and deterministic
    // (the program cache is keyed on the source).
    //
    // isolate is for function bodies (captureFunction): they start with nothing built and no lets,
    // since a function cannot see the enclosing scope.
    let capture = (fn, isolate) => {
      let outerStatements = ctx.statements
      let outerBuilt = ctx.built
      let outerLets = ctx.lets
      let outerCarried = ctx.carried
      let outerExprs = ctx.exprs
      let outerAliases = ctx.aliases
      ctx.statements = []
      // Remembered expressions never carry into a block, even one that can see the enclosing scope.
      // A loop body runs again after its own write-backs, so an outer variable computed from the
      // carried value's *first* value is not what the same text means on the second iteration.
      // The same goes for a copy: it may be of a value the body goes on to assign.
      ctx.exprs = new Map()
      ctx.aliases = new Map()
      ctx.built = isolate ? new Map() : new Map(Array.from(outerBuilt, ([node, byInput]) => [node, new Map(byInput)]))
      ctx.lets = isolate ? {} : Object.assign({}, outerLets)
      ctx.carried = isolate ? {} : Object.assign({}, outerCarried)
      let out, statements
      try {
        out = fn()
      } finally {
        statements = ctx.statements
        ctx.statements = outerStatements
        ctx.built = outerBuilt
        ctx.lets = outerLets
        ctx.carried = outerCarried
        ctx.exprs = outerExprs
        ctx.aliases = outerAliases
      }
      return {out: out, statements: statements}
    }
    ctx.captureBlock = (fn) => capture(fn, false)
    // The body of a real GLSL function (pxfn{}, shader-function.js). Isolated because a function is
    // declared once with fixed parameters, so it cannot capture the caller's scope. It can still
    // reach file scope - uniforms, samplers, helpers and the seed, which is why this hoists v0.
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
    // Two uniform slots share a name when fed by the same expression in the same scope, since they
    // then hold the same value every frame; each slot otherwise costs a uniform, a per-frame
    // evalParamFrame, and bytes on the wire for a display bound chain (draw/hub75/host/hub75.js).
    //
    // Constants (numbers or maps of them, directly or through bindings) get no slot at all: they are
    // folded into the source as GLSL literals (glslLiteral). The tradeoff: editing a constant while
    // playing recompiles the shader, but DSL chains cost what the equivalent GLSL would, and common
    // subexpressions become visible (addStatement).
    //
    // Dedupable, keyed on where a value comes from rather than what it evaluates to:
    //  - an object literal whose leaves are numbers or strings, keyed by identity; it cannot read
    //    the call context, so it means the same wherever it is reached.
    //  - a lookup that can name its binding (expression/parse-var.js), keyed on its {ast, context}.
    //    A bare number as the resolved root takes part by value, but a bare number written directly
    //    as a uniform's AST does not, keeping mul{2} and add{2} on separate uniforms.
    // Anything else gets a slot of its own.
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
    // A constant as the GLSL literal toVec4 would have made of it each frame, or undefined for
    // anything that could change: only a number, or a map of nothing but numbers and strings, can't.
    // A float literal needs a point or an exponent in GLSL; a non-finite value has no literal at all
    // and stays a uniform. The literal rounds to the same float32 the uniform upload did.
    let glslFloat = (n) => {
      let s = String(n)
      return /[.eE]/.test(s) ? s : s + '.0'
    }
    // toVec4 hands back float32s (a Float32Array), whose exact decimal expansion is long and
    // meaningless (0.2 comes back as 0.20000000298023224): print the shortest decimal that rounds
    // to the same float32 instead, which is exactly what the uniform upload would have sent
    let glslFloat32 = (n) => {
      for (let p = 1; p <= 9; p++) {
        let s = n.toPrecision(p)
        if (Math.fround(parseFloat(s)) === n) { return glslFloat(parseFloat(s)) }
      }
      return glslFloat(n)
    }
    let glslLiteral = (ast) => {
      if (typeof ast === 'number') {
        return isFinite(ast) ? `vec4(${glslFloat(ast)})` : undefined
      }
      if (!isObjectLiteral(ast)) { return undefined }
      let v = Array.from(toVec4(ast))
      if (!v.every(isFinite)) { return undefined }
      if (v.every(x => x === v[0])) { return `vec4(${glslFloat32(v[0])})` }
      return `vec4(${v.map(glslFloat32).join(', ')})`
    }
    let uniformKey = (ast) => {
      if (isObjectLiteral(ast)) { return {ast: ast, context: null} }
      if (typeof ast === 'function' && ast._bindingSource !== undefined) {
        let source = ast._bindingSource()
        if (source !== undefined) { return source }
      }
      // Any other expression reached again in the same call tree: the per frame eval memoises on
      // exactly that pair (the AST's identity and getCallTreeString, player/eval-param.js), so the
      // two already evaluate to one value every frame, and giving them one slot changes nothing but
      // the source. It matters for common subexpressions: a subtree built twice (a lambda arg read
      // in two channels of a set{}) only reads the same text if its uniforms have the same names.
      if (typeof ast === 'function') { return {ast: ast, context: 'tree:' + getCallTreeString()} }
      return undefined
    }
    ctx.addUniform = (ast) => {
      // Called from inside a node's build, so the call tree is already the one the AST was written
      // in - which is exactly the scope the binding has to be resolved in
      let key = uniformKey(ast)
      let literal = glslLiteral(ast)
      if (literal === undefined && key !== undefined) { literal = glslLiteral(key.ast) }
      if (literal !== undefined) { return literal }
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
    // Two declarations whose bodies say the same thing are one declaration. The match is on a
    // canonical form with the declaration's own name and locals renumbered in order of appearance.
    // Everything meaningful outside the body is left as is, which makes the match safe:
    //  - the seed (ctx.rootInput) is one file scope variable;
    //  - u_vsN/u_vstexN/u_vsexN are value slots, so matching bodies read the same slots and no
    //    uniform is orphaned;
    //  - a nested l_fnN is already deduped (innermost first), so equal bodies name equal functions.
    // uvN/arN (tex{} locals) are not canonicalised, so texture sampling bodies never match: a
    // missed dedupe, never a wrong one.
    let canonicalFunction = (name, source) => {
      let names = {}
      let canon = source.replace(new RegExp('\\b'+name+'\\b', 'g'), '$self')
      return canon.replace(/\bl_p\d+\b|\bl_i\d+\b|\bv\d+\b/g, (m) => {
        if (m === ctx.rootInput) { return m }
        if (names[m] === undefined) { names[m] = '$' + Object.keys(names).length }
        return names[m]
      })
    }
    let functionBodies = new Map() // canonical body -> the name it was first declared under
    // A GLSL helper function declared before main, for a node whose expression needs more than one
    // line. Deduped by name; names are fixed literals with an l_ prefix to avoid generated names.
    //
    // shareBody also dedupes by body. Only pxfn{} (shader-function.js) uses it: its names come from
    // counters, so a pxfn used in each repeat of a parallel{}/loop{} would otherwise be declared
    // once per repeat.
    ctx.addFunction = (name, source, shareBody) => {
      if (ctx.functions.some(f => f.name === name)) { return name }
      if (shareBody === true) {
        let canon = canonicalFunction(name, source)
        let already = functionBodies.get(canon)
        if (already !== undefined) { return already }
        functionBodies.set(canon, name)
      }
      ctx.functions.push({name: name, source: source})
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
    // A function body cannot see main's locals, including the seed, which the uv node reads from
    // anywhere. So a shader with a function hoists the seed to file scope.
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

  // Constants are GLSL literals, not uniforms: a number, or a map of numbers
  let litCtx = makeContext()
  assert('vec4(2.0)', litCtx.addUniform(2))
  assert('vec4(0.5)', litCtx.addUniform(1/2))
  assert('vec4(-0.1)', litCtx.addUniform(-0.1))
  assert('vec4(1e-7)', litCtx.addUniform(1e-7))
  assert('vec4(1.0, 0.0, 0.0, 1.0)', litCtx.addUniform({r:1,g:0,b:0,a:1}))
  assert('vec4(0.5)', litCtx.addUniform({x:0.5,y:0.5,z:0.5,w:0.5}))
  assert('vec4(0.2, 0.2, 0.2, 0.0)', litCtx.addUniform({r:0.2,g:0.2,b:0.2,a:0})) // Not 0.20000000298023224: the float32 it rounds to, shortest
  assert(0, litCtx.uniforms.length)
  assert('u_vs0', litCtx.addUniform(Infinity)) // No literal for it
  assert('u_vs1', litCtx.addUniform(ast)) // Anything that could change stays a uniform

  // Common subexpressions: the same expression in scope is the same variable
  let cseCtx = makeContext()
  assert('v1', cseCtx.addStatement('sin(v0)'))
  assert('v1', cseCtx.addStatement('sin(v0)'))
  assert('v2', cseCtx.addStatement('sin(v0)', true)) // Fresh: a variable of its own, to be assigned
  assert('v1', cseCtx.addStatement('sin(v0)')) // and never reused
  assert('v3', cseCtx.addStatement('cos(v2)'))
  cseCtx.addRaw('v2 = v1;') // Assigning v2 forgets what was computed from it
  assert('v4', cseCtx.addStatement('cos(v2)'))
  assert('v1', cseCtx.addStatement('sin(v0)')) // but nothing else
  cseCtx.addRaw('v0.x += 1.0;') // A swizzled or compound assignment counts too
  assert('v5', cseCtx.addStatement('sin(v0)'))
  // A copy is the value it copied, so an expression of the copy is the same expression
  let actx = makeContext()
  assert('v1', actx.addStatement('v0')) // The copy is still emitted
  assert('v2', actx.addStatement('sin(v0)'))
  assert('v2', actx.addStatement('sin(v1)'))
  actx.addRaw('v1 = v2;') // until either is assigned
  assert('v3', actx.addStatement('sin(v1)'))
  // A block remembers nothing from outside it (a loop body runs again after its write-backs), and
  // nothing from inside it survives it
  let cseBlock = cseCtx.captureBlock(() => cseCtx.addStatement('sin(v0)'))
  assert('v6', cseBlock.out)
  assert('v5', cseCtx.addStatement('sin(v0)'))
  assert(true, cseCtx.statements.every(st => !st.includes('v6')))
  // Two copies of a subtree with constants in them now read the same, and collapse
  let dupe = () => binaryShaderNode((a,b) => `${a} * ${b}`, undefined, makeShaderNode((i, c) => c.addStatement(`sin(${i})`)), 3, 3)
  let dupes = buildSource(binaryShaderNode((a,b) => `${a} + ${b}`, undefined, dupe(), undefined, dupe()))
  assert(true, dupes.source.includes('vec4 v3 = v2 + v2;'))
  assert(0, dupes.uniforms.length)

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

  // shareBody: a declaration whose body says the same thing as one already made *is* that
  // declaration, and its name is what comes back. Only pxfn{} asks for this (shader-function.js),
  // and it is what collapses one function per repeat of a parallel{}/loop{} into one, since each
  // repeat resolves a node of its own and so asks for a declaration of its own.
  let decl = (i, body) => `vec4 l_fn${i}(vec4 l_p${i}) {\n  ${body}\n  return v${i*2+1};\n}`
  let bodyCtx = makeContext()
  assert('l_fn0', bodyCtx.addFunction('l_fn0', decl(0, 'vec4 v1 = a(l_p0);'), true))
  assert('l_fn1', bodyCtx.addFunction('l_fn1', decl(1, 'vec4 v3 = b(l_p1);'), true)) // A different body
  assert(2, bodyCtx.functions.length)
  // The same body, numbered differently because nextVar keeps counting: one declaration, and the
  // first name for both call sites
  assert('l_fn0', bodyCtx.addFunction('l_fn2', decl(2, 'vec4 v5 = a(l_p2);'), true))
  assert(2, bodyCtx.functions.length)
  assert(['l_fn0','l_fn1'], bodyCtx.functions.map(f => f.name))
  // A uniform slot is a value, not a local, so two bodies reading different slots are different
  // bodies — which is also why dropping a duplicate can never orphan a uniform
  assert('l_fn3', bodyCtx.addFunction('l_fn3', decl(3, 'vec4 v7 = a(l_p3) * u_vs0;'), true))
  assert('l_fn4', bodyCtx.addFunction('l_fn4', decl(4, 'vec4 v9 = a(l_p4) * u_vs1;'), true))
  assert('l_fn3', bodyCtx.addFunction('l_fn5', decl(5, 'vec4 v11 = a(l_p5) * u_vs0;'), true)) // Same slot: same body
  // Nor is a nested function's name, where a loop counter is a local like any other
  assert('l_fn6', bodyCtx.addFunction('l_fn6', decl(6, 'vec4 v13 = l_fn0(l_p6);'), true))
  assert('l_fn7', bodyCtx.addFunction('l_fn7', decl(7, 'vec4 v15 = l_fn1(l_p7);'), true))
  assert('l_fn8', bodyCtx.addFunction('l_fn8', decl(8, 'for (int l_i0 = 0; l_i0 < 2; l_i0++) { }\n  vec4 v17 = a(l_p8);'), true))
  assert('l_fn8', bodyCtx.addFunction('l_fn9', decl(9, 'for (int l_i1 = 0; l_i1 < 2; l_i1++) { }\n  vec4 v19 = a(l_p9);'), true))
  // The seed is one file scope variable, so two bodies reading it agree about it
  assert('l_fn10', bodyCtx.addFunction('l_fn10', decl(10, 'vec4 v21 = a(l_p10) + v0;'), true))
  assert('l_fn10', bodyCtx.addFunction('l_fn11', decl(11, 'vec4 v23 = a(l_p11) + v0;'), true))
  // A helper asks for none of this: it is deduped by its fixed name alone, so a shader with no
  // pxfn in it keeps generating exactly the source it always did
  let helperCtx = makeContext()
  helperCtx.addFunction('l_a', 'vec4 l_a(vec4 p) { return p; }')
  assert('l_b', helperCtx.addFunction('l_b', 'vec4 l_b(vec4 p) { return p; }')) // Same body, still declared
  assert(2, helperCtx.functions.length)

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
  assert(true, arithBuilt.source.includes('vec4 v3 = v2 + vec4(0.0, 0.5, 0.0, 1.0);')) // A constant colour is a literal
  assert(true, arithBuilt.source.includes('fragColor = v3;'))
  assert(2, arithBuilt.uniforms.length)
  assert(true, arithBuilt.uniforms[1].ast === twoAst) // raw ASTs, re-evaluated per frame
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

  // ctx.carried travels with ctx.lets: a loop{}'s carried names are visible inside a nested block
  // and go out of scope with the block they were declared in
  let carryCtx = makeContext()
  carryCtx.lets.t = 'v1'
  carryCtx.carried.t = 'v1'
  carryCtx.captureBlock(() => {
    assert('v1', carryCtx.carried.t) // An outer carried name is in scope inside the block
    carryCtx.carried.u = 'v2'
    carryCtx.lets.u = 'v2'
  })
  assert([true, false], [carryCtx.carried.t === 'v1', carryCtx.carried.u !== undefined])
  carryCtx.captureFunction(() => { assert({}, carryCtx.carried) }) // and a function body sees none of them
  assert('v1', carryCtx.carried.t)

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
    let acc = ctx.addStatement(input, true)
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
  // on where a value comes from, never on what it evaluates to. A constant never takes a slot at
  // all: it is a literal (tested above).
  let dctx = makeContext()
  let offset = {x:1, w:0}
  assert('vec4(1.0, 0.0, 0.0, 0.0)', dctx.addUniform(offset))
  assert('vec4(1.0, 0.0, 0.0, 0.0)', dctx.addUniform({x:1, w:0})) // Equal literals are equal source
  assert('vec4(2.0)', dctx.addUniform(2))
  assert(0, dctx.uniforms.length)
  let notLiteral = {x: () => 1} // An expression inside the map can read the call context
  assert('u_vs0', dctx.addUniform(notLiteral))
  assert('u_vs1', dctx.addUniform(notLiteral))
  assert(2, dctx.uniforms.length)
  assert(true, dctx.uniforms[0].ast === notLiteral) // The raw AST is still what gets registered
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
  assert('u_vs3', bctx.addUniform(unresolved)) // Nothing to name: keyed on the expression and the call tree instead
  assert('u_vs3', bctx.addUniform(unresolved)) // which is the pair the per frame eval memoises on, so one slot
  assert('u_vs4', bctx.addUniform(() => 0)) // Another expression is another slot

  // A binding that resolves to a constant is that constant: fbm3's `seed` defaults to 0, and all 32
  // of its references are the literal
  let cctx = makeContext()
  assert('vec4(0.0)', cctx.addUniform(lookupTo(0, undefined)))
  assert('vec4(1.0)', cctx.addUniform(lookupTo(1, undefined)))
  assert('vec4(1.0, 0.0, 0.0, 1.0)', cctx.addUniform(lookupTo({r:1,g:0,b:0,a:1}, undefined)))
  assert(0, cctx.uniforms.length)

  // Sharing survives a captured block, unlike the emit-once map above it: uniforms are declared at
  // file scope, so a slot registered inside a loop body is still in scope after the closing brace
  let lctx = makeContext()
  let blockBinding = lookupTo(binding, frame)
  lctx.captureBlock(() => lctx.addUniform(blockBinding))
  assert('u_vs0', lctx.addUniform(blockBinding))
  assert(1, lctx.uniforms.length)

  // Sharing is per context, like every other generated name
  assert('u_vs0', makeContext().addUniform(notLiteral))

  console.log('Visual synth codegen tests complete')
  }

  return {
    makeContext: makeContext,
    buildSource: buildSource,
  }
})
