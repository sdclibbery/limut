'use strict';
define(function (require) {
  let system = require('draw/system')
  let playSystem = require('play/system')
  let common = require('draw/shadercommon')

  let fragSource = `#version 300 es
  precision highp float;
  in vec2 fragCoord;
  uniform sampler2D l_image;
  uniform vec2 l_extents;
  ${common.commonProcessors}
  void main() {
    vec2 pos = preprocess(fragCoord);
    pos = (pos / 2.0) + 0.5;
    // float freq = 24000.0 * pow((pos.x+0.5)*2.0,10.0)/4096.0;
    float freq = 24000.0 * pow(pos.x+1.0,10.0)/1024.0;
    float value = texture(l_image, vec2(freq/24000.0,0.0)).r;
    value = (pos.x<0.0) ? 0.0 : value;
    value = (pos.x>1.0) ? 0.0 : value;
    value = (100.0+value)/200.0;
    float f = pow(1.0-abs(pos.y - (value+0.5)), 200.0);
    postprocess(vec4(f,f,f,1.0), 1.0);
  }
  `

  let texture
  let lastUpdateTime
  let getScopeTexture = () => {
    if (texture) { return texture }
    texture = {}
    texture.tex = system.gl.createTexture()
    texture.update = (state) => {
      if (state.time === lastUpdateTime) { return }
      lastUpdateTime = state.time
      system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
      let data = playSystem.fft()
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.R16F, data.length, 1, 0, system.gl.RED, system.gl.FLOAT, data)
    }
    texture.params = () => {
      system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_MIN_FILTER, system.gl.LINEAR);
      system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_MAG_FILTER, system.gl.LINEAR);
      system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_S, system.gl.CLAMP_TO_EDGE);
      system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_T, system.gl.CLAMP_TO_EDGE);
    }
    return texture
  }

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
      common.getCommonUniforms(shader)
      shader.texture = getScopeTexture()
    }
    return shader
  }
})
