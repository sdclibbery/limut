'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')

  let fragSource = `
  precision highp float;
  varying vec2 fragCoord;
  uniform float iTime;
  uniform float l_value;
  uniform float l_amp;
  uniform sampler2D l_image;
  uniform vec2 l_extents;
  ${common.commonProcessors}
  void main() {
    vec2 uv = fragCoord;
    float ar = l_extents.x / l_extents.y;
    if (ar > 1.0) { uv.x /= ar; } else { uv.y *= ar; }
    uv.y = -uv.y;
    uv = preprocess(uv);
    uv = (uv / 2.0) + 0.5;
    vec4 c = texture2D(l_image, fract(uv));
    float foreback = c.a;
    c.a = 1.0;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { foreback = 0.0; }
    postprocess(c, foreback);
  }
  `

  let vtxCompiled
  let shader
  return (params) => {
    if (shader === undefined) {
      if (!vtxCompiled) {
        vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
      }
      let program
      try {
        program = system.loadProgram([
          vtxCompiled,
          system.loadShader(fragSource, system.gl.FRAGMENT_SHADER)
        ])
      } catch (e) {
        shader.program = null
        throw e
      }
      shader = {}
      shader.program = program || null
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
      shader.textureUnif = [system.gl.getUniformLocation(program, 'l_image')]
      shader.extentsUnif = system.gl.getUniformLocation(program, "l_extents")
    }
    return shader
  }
})
