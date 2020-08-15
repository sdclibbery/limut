'use strict';
define(function (require) {
  let system = require('draw/system')

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 fragCoordIn;
  varying vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`
  let vtxCompiled

  let commonProcessors = (`
  uniform vec2 scroll;
  uniform vec2 zoom;
  uniform float perspective;
  uniform float pixellate;
  vec2 preprocess( vec2 coord ) {
    coord = (coord + scroll) / zoom;
    if (perspective != 0.) { coord.x *= perspective/(coord.y+perspective); }
    if (pixellate != 0.) { coord = floor(coord*pixellate)/pixellate; }
    return coord;
  }
  void postprocess( vec4 col ) {
    gl_FragColor = col*brightness*col.a;
    if (gl_FragColor.a < 0.01) discard;
  }
  `).replace(/\n/g,' ')

  let shaders = {}

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
        let source = request.response.replace('#insert common-processors', commonProcessors)
        shaders[url] = {fragSource: source}
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
      shader.spectrumUnif = system.gl.getUniformLocation(program, "spectrum")
      shader.scrollUnif = system.gl.getUniformLocation(program, "scroll")
      shader.zoomUnif = system.gl.getUniformLocation(program, "zoom")
      shader.pixellateUnif = system.gl.getUniformLocation(program, "pixellate")
      shader.perspectiveUnif = system.gl.getUniformLocation(program, "perspective")
    }
    return shader
  }
})
