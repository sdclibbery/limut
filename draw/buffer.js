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

  let createRenderTarget = (rez) => {
    let gl = system.gl
    // Texture
    let texture = {}
    texture.width = system.cw * rez
    texture.height = system.ch * rez
    let tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    texture.tex = tex
    // Also create the framebuffer to render into
    texture.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, texture.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.tex, 0)
    return texture
  }

  let initBuffer = (buffer) => {
    // Create render target
    buffer.texture = createRenderTarget(buffer.rez)
    buffer.shader.texture = buffer.texture
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
    let feedback = params.feedback
    if (buffer.shader === undefined || buffer.rez !== rez || system.cw !== buffer.systemCw || system.ch !== buffer.systemCh || (!!feedback) !== (!!buffer.feedback)) {
      buffer.rez = rez
      buffer.systemCw = system.cw
      buffer.systemCh = system.ch
      buffer.feedback = feedback
      initProgram(buffer)
      initBuffer(buffer)
      player.buffer = buffer
    }
    return buffer.shader
  }
})
