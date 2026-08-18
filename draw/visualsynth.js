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
      } catch (e) {
        programs[built.source] = null
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
        built.uniforms.forEach((u, i) => {
          // Restore the call tree the arg was written in, so an AST from inside a user defined
          // function (eg the `size` in `set pixellate = {in,size} -> floor{in,to:1/size}`) still
          // resolves now that the call has long returned
          let outer = getCallTree()
          clearCallTree()
          setCallTree(u.callTree)
          let v
          try {
            v = evalParamFrame(u.ast, params, state.count)
          } finally {
            clearCallTree()
            setCallTree(outer)
          }
          system.gl.uniform4fv(cached.uniformLocs[i], toVec4(v))
        })
      }
    }
    return s
  }
})
