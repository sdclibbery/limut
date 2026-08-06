'use strict'
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let consoleOut = require('console')
  let {evalParamEvent, evalParamFrame} = require('player/eval-param')
  let {buildSource} = require('draw/visualsynth/codegen')
  let {isShaderNode, toVec4} = require('draw/visualsynth/shader-node')
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
    if (built.textures.length > 0) { s.texture = built.textures[0] }
    if (built.textures.length > 1) { warnOnce(`🟠 visualsynth: only one texture per chain supported for now`) }
    if (built.uniforms.length > 0) {
      s.preRender = (state) => {
        system.gl.useProgram(cached.shader.program)
        built.uniforms.forEach((u, i) => {
          let v = evalParamFrame(u.ast, params, state.count)
          system.gl.uniform4fv(cached.uniformLocs[i], toVec4(v))
        })
      }
    }
    return s
  }
})
