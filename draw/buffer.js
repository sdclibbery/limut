'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let renderList = require('draw/render-list')
  let {evalParamEvent} = require('player/eval-param')

  let fragSource = `#version 300 es
  precision highp float;
  in vec2 fragCoord;
  uniform float l_value;
  uniform float l_amp;
  uniform sampler2D l_image;
  uniform vec2 l_extents;
  ${common.commonProcessors}
  void main() {
    vec2 uv = fragCoord;
    float ar = l_extents.x / l_extents.y;
    uv.x /= ar;
    uv = preprocess(uv);
    uv = (uv+1.0)/2.0;
    vec4 c = texture(l_image, fract(uv));
    float foreback = c.a;
    c.a = 1.0;
    postprocess(c, foreback);
  }
  `

  let initBuffer = (buffer) => {
    let gl = system.gl
    // Texture
    buffer.texture = {}
    buffer.texture.width = system.cw * buffer.rez
    buffer.texture.height = system.ch * buffer.rez
    let texture = buffer.texture
    texture.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, buffer.texture.width, buffer.texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    buffer.shader.texture = texture
    // Also create the framebuffer to render into
    buffer.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.tex, 0)
    // Render list
    buffer.renderList = renderList()
    buffer.shader.preRender = (state) => {
      buffer.renderList.render(state)
    }
}

  let program
  let initProgram = (buffer) => {
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
  }

  return (params) => {
    let player = params._player
    let buffer = player.buffer || {}
    let rez = evalParamEvent(params.rez, params) || 1/2
    if (buffer.shader === undefined || buffer.rez !== rez || system.cw !== buffer.systemCw || system.ch !== buffer.systemCh) {
      buffer.rez = rez
      buffer.systemCw = system.cw
      buffer.systemCh = system.ch
      initProgram(buffer)
      initBuffer(buffer)
      player.buffer = buffer
    }
    return buffer.shader
  }
})
