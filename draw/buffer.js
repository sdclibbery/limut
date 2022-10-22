'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let renderList = require('draw/render-list')

  let fragSource = `#version 300 es
  precision highp float;
  in vec2 fragCoord;
  uniform float l_value;
  uniform float l_amp;
  uniform sampler2D l_image;
  uniform vec2 l_extents;
  ${common.commonProcessors}
  void main() {
    vec2 uv = (fragCoord+1.0)/2.0;
    uv = preprocess(uv);
    vec4 c = texture(l_image, fract(uv));
    float foreback = c.a;
    c.a = 1.0;
    postprocess(c, foreback);
  }
  `

  let initBuffer = (buffer) => {
    let gl = system.gl
    buffer.texture = {}
    let texture = buffer.texture
    texture.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // Also create the framebuffer to render into
    buffer.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.tex, 0)
    // Render list
    buffer.renderList = renderList()
  }

  let getTexture = (buffer) => {
    if (!buffer.texture) {
      initBuffer(buffer)
    }
    return buffer.texture
  }

  let program
  return (params) => {
    let player = params._player
    player.buffer = player.buffer || {}
    let buffer = player.buffer
    if (buffer.shader === undefined) {
      buffer.shader = {}
      if (!program) {
        let vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
        try {
          program = system.loadProgram([
            vtxCompiled,
            system.loadShader(fragSource, system.gl.FRAGMENT_SHADER)
          ])
        } catch (e) {
          buffer.shader.program = null
          throw e
        }
      }
      buffer.shader.program = program || null
      common.getCommonUniforms(buffer.shader)
      buffer.shader.texture = getTexture(buffer)
      buffer.shader.preRender = (state) => {
        buffer.renderList.render(state)
      }
    }
    return buffer.shader
  }
})
