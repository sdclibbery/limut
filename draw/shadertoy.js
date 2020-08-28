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

  let commonProcessors = `
    uniform vec2 scroll;
    uniform vec2 zoom;
    uniform float perspective;
    uniform float pixellate;
    uniform float additive;
    uniform vec4 fore;
    uniform vec4 back;
    uniform float brightness;
    vec2 preprocess( vec2 coord ) {
    if (perspective != 0.) {
      const float sz = 1.0;
      const float pz = 1.0;
      vec2 s = coord / sz;
      float p = (s.y*sin(perspective*0.68) + cos(perspective*0.68));
      vec2 uv = vec2(
        s.x*pz/p,
        s.y*pz/p
      );
      coord = uv;
    }
    coord = (coord + scroll) / zoom;
    if (pixellate != 0.) { coord = floor(coord*pixellate)/pixellate; }
    return coord;
  }
  void postprocess( vec4 col, float foreBack ) {
    col *= mix(back, fore, foreBack);
    gl_FragColor.rgb = col.rgb*brightness*mix(col.a, 1.0, additive);
    gl_FragColor.a = mix(col.a, 0.0, additive);
    if (length(gl_FragColor) < 0.01) discard;
  }
  `

  let pre = `precision highp float; vec2 iResolution = vec2(1.,1.); vec4 iMouse = vec4(0.); uniform float iTime;`

  let post = `
  varying vec2 fragCoord;
  uniform float value;
  uniform float amp;
  void main() {
    vec4 fragColor;
    vec2 uv = preprocess(fragCoord)/2.0;
    mainImage( fragColor, uv );
    postprocess(fragColor, 1.0);
  }
  `
  let shaders = {}

  let getUrl = (id) => {
    return "https://www.shadertoy.com/api/v1/shaders/"+id+"?key=rdHKM4"
  }

  return (params) => {
    let url = getUrl(param(params.id, 'MsGczV'))
    if (shaders[url] === undefined) {
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        let code = JSON.parse(request.response).Shader.renderpass[0].code
        let source = pre + code + commonProcessors + post
        shaders[url] = {fragSource: source}
      }
      request.send()
    }
    let shader = shaders[url]
    if (shader === undefined || shader.fragSource === undefined) { return }
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
