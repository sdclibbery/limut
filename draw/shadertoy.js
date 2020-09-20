'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')
  let common = require('draw/shadercommon')
  let consoleOut = require('console')

  let evalPerEventParam = (params, p, def) =>{
    return evalParam(param(params[p], def), params.idx, params.beat.count)
  }

  let pre = `precision highp float; varying vec2 fragCoord; uniform float l_value; uniform float l_amp; vec2 iResolution = vec2(100.,100.); vec4 iMouse = vec4(0.); uniform float iTime;
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
    let id = evalPerEventParam(params, 'id', 'Mss3Wf')
    let url = getUrl(id)
    if (shaders[url] === undefined) {
      shaders[url] = {}
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        let json = JSON.parse(request.response)
        if (json.Error) {
          let msg = `Shadertoy load error: ${json.Error} for ${id}`
          consoleOut(msg)
          throw msg
        }
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
      shader.program = program || null
      common.getCommonUniforms(shader)
    }
    return shader
  }
})
