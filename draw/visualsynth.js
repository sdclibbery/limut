'use strict'
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let consoleOut = require('console')
  let {evalParamEvent, evalParamFrame} = require('player/eval-param')
  let {buildSource} = require('draw/visualsynth/codegen')
  let {isShaderNode, toVec4} = require('draw/visualsynth/shader-node')
  let {getCallTree, setCallTree, clearCallTree} = require('player/callstack')
  let hub75 = require('draw/hub75/host/hub75')
  require('draw/visualsynth/nodes') // Register mul/tex/webcam var functions at startup

  let vtxCompiled
  let programs = {} // fragSource -> {shader, uniformLocs}, or null for permanent compile failure
  let programOrder = [] // insertion order of the keys of `programs`, so the cache can be bounded
  // A px chain must generate byte identical source every event: the source *is* the program cache
  // key (codegen.js names everything from counters for exactly this reason), so a chain whose
  // source moves recompiles a shader per event instead of once. That is a synchronous compile and
  // link on the main thread, inside the beat scheduling window, which is enough to make audio
  // events late. It is a silent failure otherwise, so it is checked rather than assumed.
  // The cap is a backstop for a chain that slips past the check above: it bounds the map and its
  // (large) source string keys. The GL programs themselves are not deleted, because a sprite built
  // from an earlier event still holds the shader object and would then useProgram a deleted
  // program; the warning, not the eviction, is what is meant to stop this happening.
  let maxPrograms = 64
  let remember = (source) => {
    programOrder.push(source)
    while (programOrder.length > maxPrograms) { delete programs[programOrder.shift()] }
  }
  // Keyed on the px AST rather than the player: editing the line reparses it into a new AST object,
  // so a live edit legitimately generating different source is a new entry rather than a warning.
  // The same AST giving different source twice is the real fault.
  let lastSource = new WeakMap()
  let firstDifference = (a, b) => {
    let al = a.split('\n'), bl = b.split('\n')
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
      if (al[i] !== bl[i]) { return `line ${i+1}: ${JSON.stringify(al[i])} -> ${JSON.stringify(bl[i])}` }
    }
    return 'no line differs (length only)'
  }
  let warned = {}
  let warnOnce = (msg) => {
    if (warned[msg]) { return }
    warned[msg] = true
    consoleOut(msg)
  }

  return (params) => {
    let node = evalParamEvent(params.px, params)
    if (!isShaderNode(node)) {
      warnOnce(`🔴 visualsynth needs px set to a visual node chain, eg px=tex{webcam{}}`)
      return
    }
    let built = buildSource(node)
    if (built.notReady) { return } // eg webcam not enumerated yet; the next event retries
    // A named display takes the whole chain instead of the canvas. Everything shippable is already
    // in `built` - the generated shader is self contained - so this is a tap on the existing seam
    // rather than a second rendering path. See draw/hub75/PROTOCOL.md.
    let display = evalParamEvent(params.display, params)
    if (display !== undefined) {
      hub75.setLayer(String(display), params, built)
      return // nothing drawn locally; sprite.js turns a falsy result into a task that removes itself
    }
    hub75.releaseFor(params._player && params._player.id) // eg display= edited back off the line
    if (params.px !== null && (typeof params.px === 'object' || typeof params.px === 'function')) {
      let prev = lastSource.get(params.px)
      if (prev !== undefined && prev !== built.source) {
        let who = (params._player && params._player.id) || 'visualsynth'
        warnOnce(`🔴 Visual synth: the px chain for ${who} generates different shader source each event, so it recompiles a shader instead of reusing the cached program. Values that change must reach the shader as uniforms. First difference: ${firstDifference(prev, built.source)}`)
      }
      lastSource.set(params.px, built.source)
    }
    let cached = programs[built.source]
    if (cached === undefined) {
      try {
        if (!vtxCompiled) {
          vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
        }
        let program = system.loadProgram([
          vtxCompiled,
          system.loadShader(built.source, system.gl.FRAGMENT_SHADER)
        ])
        let shader = { program: program }
        common.getCommonUniforms(shader)
        shader.textureUnif = built.textures.map((t,i) => system.gl.getUniformLocation(program, 'u_vstex'+i))
        shader.extentsUnifs = built.textures.map((t,i) => system.gl.getUniformLocation(program, 'u_vsex'+i)) // Per texture, so several can coexist. Null for a texture whose extents nothing reads (eg a lut)
        cached = {
          shader: shader,
          uniformLocs: built.uniforms.map(u => system.gl.getUniformLocation(program, u.name)),
        }
        programs[built.source] = cached
        remember(built.source)
      } catch (e) {
        programs[built.source] = null
        remember(built.source)
        consoleOut(`🔴 Visual synth shader error: ${e}`)
        return
      }
    }
    if (cached === null) { return }
    // Per-event wrapper over the shared compiled program: textures and uniform ASTs are per event
    let s = Object.create(cached.shader)
    if (built.textures.length > 0) { s.textures = built.textures.map(t => t.texture) } // sprite.js binds each to its own slot
    if (built.uniforms.length > 0) {
      s.preRender = (state) => {
        system.gl.useProgram(cached.shader.program)
        // Each arg is evaluated with the call tree it was written in restored, so an AST from
        // inside a user defined function (eg the `size` in
        // `set pixellate = {in,size} -> floor{in,to:1/size}`) still resolves now that the call has
        // long returned. getCallTree deep copies the whole tree (player/callstack.js), so the
        // caller's tree is saved once for the loop rather than once per uniform - a chain with a
        // dozen uniforms was copying it a dozen times every frame. Each iteration still clears
        // before setting, which is what setCallTree requires and what keeps one arg's frames from
        // leaking into the next.
        let outer = getCallTree()
        try {
          built.uniforms.forEach((u, i) => {
            clearCallTree()
            setCallTree(u.callTree)
            system.gl.uniform4fv(cached.uniformLocs[i], toVec4(evalParamFrame(u.ast, params, state.count)))
          })
        } finally {
          clearCallTree()
          setCallTree(outer)
        }
      }
    }
    return s
  }
})
