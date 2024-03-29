'use strict';
define(function (require) {
  let metronome = require('metronome')
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let renderList = require('draw/render-list')
  let {evalParamEvent} = require('player/eval-param')
  let sprite = require('draw/sprite')

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
    uv = preprocess(uv);
    float ar = l_extents.x / l_extents.y;
    uv.x /= ar;
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
     // NOTE: passing null to texImage2D leads to an "incurring lazy initialization" warning in Firefox. This is not a problem.
    texture.tex = tex
    // Also create the framebuffer to allow rendering into the texture
    texture.framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, texture.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.tex, 0)
    return texture
  }

  let initBuffer = (buffer) => {
    // Create render target(s)
    buffer.rt = []
    buffer.rt[0] = createRenderTarget(buffer.rez)
    if (buffer.feedback) { // For feedback need a second texture because you cant render a texture to itself
      buffer.rt[1] = createRenderTarget(buffer.rez)
      buffer.flipShader = initShader()
      buffer.fore = {r:0.99,g:0.99,b:0.99,a:0.99}
      buffer.back = {r:1,g:1,b:1,a:1}
// buffer.rt[0].id = buffer._playerId+'-'+'rt[0]'
// buffer.rt[1].id = buffer._playerId+'-'+'rt[1]'
    }
    buffer.current = 0
    buffer.target = buffer.rt[buffer.current]
    buffer.shader.texture = buffer.rt[buffer.current]
    // Render list
    buffer.renderList = renderList()
    buffer.shader.preRender = (state) => {
      if (buffer.feedback) {
        // Flip render targets if using feedback
        buffer.current = 1 - buffer.current // Flip
        buffer.target = buffer.rt[buffer.current] // Render into new texture
        buffer.shader.texture = buffer.rt[buffer.current] // Render to screen from new texture
        // Apply feedback
        buffer.feedback.beat = metronome.lastBeat()
        buffer.feedback.buffer = buffer._playerId // Feedback to current texture
        buffer.feedback.isBufferFeedback = true
        buffer.flipShader.texture = buffer.rt[1-buffer.current] // Feedback from old texture
        sprite.play(()=>buffer.flipShader, buffer.feedback)(state) // Draw last frame to this to provide feedback
      }
      buffer.renderList.render(state)
    }
  }

  let program
  let initShader = () => {
    let shader = {}
    if (!program) {
      let vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
      try {
        program = system.loadProgram([
          vtxCompiled,
          system.loadShader(fragSource, system.gl.FRAGMENT_SHADER)
        ])
      } catch (e) {
        shader.program = null
        throw e
      }
    }
    shader.program = program || null
    common.getCommonUniforms(shader)
    return shader
  }

  return (params) => {
    let player = params._player
    let buffer = player.buffer || {}
    let rez = evalParamEvent(params.rez, params) || 1/2
    let feedback = params.feedback
    if (!!feedback && typeof feedback !== 'object') { feedback = {} } // If feedback
    if (buffer.shader === undefined || buffer.rez !== rez || system.cw !== buffer.systemCw || system.ch !== buffer.systemCh || (!!feedback) !== (!!buffer.feedback)) {
      buffer._playerId = params._player.id
      buffer.rez = rez
      buffer.feedback = feedback
      buffer.systemCw = system.cw
      buffer.systemCh = system.ch
      buffer.shader = initShader()
      initBuffer(buffer)
      player.buffer = buffer
    }
    if (buffer.feedback) { buffer.feedback = feedback } // Update feedback params in case of code update
    return buffer.shader
  }
})
