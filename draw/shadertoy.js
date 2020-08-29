'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')
  let common = require('draw/shadercommon')

  let pre = `precision highp float; varying vec2 fragCoord; uniform float value; uniform float amp; vec2 iResolution = vec2(100.,100.); vec4 iMouse = vec4(0.); uniform float iTime;
  #define HW_PERFORMANCE 0
  `

  let post = `
  void main() {
    vec4 fragColor;
    vec2 uv = (preprocess(fragCoord)+1.0)*50.0;
    mainImage( fragColor, uv );
    float foreback = length(fragColor.rgb) < 0.01 ? 0.0 : 1.0;
    postprocess(fragColor, foreback);
  }`

  let vtxCompiled
  let shaders = {}

  let getUrl = (id) => {
    return "https://www.shadertoy.com/api/v1/shaders/"+id+"?key=rdHKM4"
  }

  return (params) => {
    let url = getUrl(param(params.id, 'Mss3Wf'))
    if (shaders[url] === undefined) {
      shaders[url] = {}
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        let json = JSON.parse(request.response)
        if (json.Error) { throw `Shadertoy load error: ${json.Error} on ${url}` }
        let code = json.Shader.renderpass[0].code
        let source = pre + code + common.commonProcessors + post
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
      shader.spectrumUnif = system.gl.getUniformLocation(program, "spectrum")
      shader.scrollUnif = system.gl.getUniformLocation(program, "scroll")
      shader.zoomUnif = system.gl.getUniformLocation(program, "zoom")
      shader.pixellateUnif = system.gl.getUniformLocation(program, "pixellate")
      shader.perspectiveUnif = system.gl.getUniformLocation(program, "perspective")
      shader.additiveUnif = system.gl.getUniformLocation(program, "additive")
    }
    return shader
  }
})
