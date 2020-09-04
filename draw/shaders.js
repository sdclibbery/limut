'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')

  let vtxCompiled
  let shaders = {}

  let getUrl = (shaderName) => {
    return "shader/"+shaderName+".frag"
  }

  let commonProcessors = common.commonProcessors.replace(/\n/g,' ')
  return (shaderName) => {
    let url = getUrl(shaderName)
    if (url === undefined) { return }
    if (shaders[url] === undefined) {
      shaders[url] = {}
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        let source = request.response.replace('#insert common-processors', commonProcessors)
        shaders[url] = {fragSource: source}
      }
      request.send()
    }
    let shader = shaders[url]
    if (shader === undefined || shader.fragSource === undefined) { return }
    if (shader.program === undefined && shader.fragSource !== undefined) {
      if (!vtxCompiled) {
        vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
      }
      let program
      try {
        program = system.loadProgram([
          vtxCompiled,
          system.loadShader(shader.fragSource, system.gl.FRAGMENT_SHADER)
        ])
      } catch (e) {
        shader.program = null
        throw e
      }
      shader.program = program
      common.getCommonUniforms(shader)
    }
    return shader
  }
})
