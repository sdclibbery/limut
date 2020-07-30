'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 fragCoordIn;
  varying vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`
  let vtxCompiled

  let shaders = {}

  let nameFromValue = {
    'x': 'swirl',
    'g': 'clouds',
    'j': 'clouds',
    'v': 'swirl',
    '&': 'swirl',
  }

  let getUrl = (shaderName) => {
    return "shader/"+shaderName+".frag"
  }

  return (shaderName) => {
    let url = getUrl(shaderName)
    if (url === undefined) { return }
    if (shaders[url] === undefined) {
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        shaders[url] = {fragSource: request.response}
      }
      request.send()
    }
    let shader = shaders[url]
    if (shader === undefined) { return }
    if (shader.program === undefined && shader.fragSource !== undefined) {
      if (!vtxCompiled) {
        vtxCompiled = system.loadShader(vtxShader, system.gl.VERTEX_SHADER)
      }
      let program =  system.loadProgram([
        vtxCompiled,
        system.loadShader(shader.fragSource, system.gl.FRAGMENT_SHADER)
      ])
      shader.program = program
      shader.posBuf = system.gl.createBuffer()
      shader.posAttr = system.gl.getAttribLocation(program, "posIn")
      shader.fragCoordBuf = system.gl.createBuffer()
      shader.fragCoordAttr = system.gl.getAttribLocation(program, "fragCoordIn")
      shader.timeUnif = system.gl.getUniformLocation(program, "iTime")
      shader.brightnessUnif = system.gl.getUniformLocation(program, "brightness")
      shader.valueUnif = system.gl.getUniformLocation(program, "value")
      shader.ampUnif = system.gl.getUniformLocation(program, "amp")
      shader.foreUnif = system.gl.getUniformLocation(program, "fore")
      shader.backUnif = system.gl.getUniformLocation(program, "back")
    }
    return shader
  }
})
