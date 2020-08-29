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
      shader.posBuf = system.gl.createBuffer()
      shader.posAttr = system.gl.getAttribLocation(program, "posIn")
      shader.fragCoordBuf = system.gl.createBuffer()
      shader.fragCoordAttr = system.gl.getAttribLocation(program, "fragCoordIn")
      shader.timeUnif = system.gl.getUniformLocation(program, "iTime")
      shader.brightnessUnif = system.gl.getUniformLocation(program, "l_brightness")
      shader.valueUnif = system.gl.getUniformLocation(program, "l_value")
      shader.ampUnif = system.gl.getUniformLocation(program, "l_amp")
      shader.foreUnif = system.gl.getUniformLocation(program, "l_fore")
      shader.backUnif = system.gl.getUniformLocation(program, "l_back")
      shader.spectrumUnif = system.gl.getUniformLocation(program, "l_spectrum")
      shader.scrollUnif = system.gl.getUniformLocation(program, "l_scroll")
      shader.zoomUnif = system.gl.getUniformLocation(program, "l_zoom")
      shader.pixellateUnif = system.gl.getUniformLocation(program, "l_pixellate")
      shader.perspectiveUnif = system.gl.getUniformLocation(program, "l_perspective")
      shader.additiveUnif = system.gl.getUniformLocation(program, "l_additive")
    }
    return shader
  }
})
