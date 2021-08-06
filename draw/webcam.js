'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let consoleOut = require('console')

  let fragSource = `#version 300 es
  precision highp float;
  in vec2 fragCoord;
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
    vec4 c = texture(l_image, fract(uv));
    float foreback = c.a*(c.r+c.g+c.b)/3.0;
    c.a = 1.0;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { foreback = 0.0; }
    postprocess(c, foreback);
  }
  `

  let video
  let accessWebcam = () => {
    video = document.createElement('video')
    return new Promise((resolve, reject) => {
      const mediaConstraints = { audio: false, video: { 
          width: {ideal: 512}, 
          height: {ideal: 512},
        }
      }
      navigator.mediaDevices.getUserMedia(
        mediaConstraints).then(mediaStream => {
          consoleOut(`: Using Webcam: ${mediaStream.getTracks()[0].label}`)
          video.srcObject = mediaStream
          video.setAttribute('playsinline', true)
          video.onloadedmetadata = (e) => {
            video.play()
            resolve(video)
          }
        }).catch(err => {
          reject(err)
        })
      }
    )
  }
  
  let texture
  let lastUpdateTime
  let getWebcamTexture = () => {
    if (texture) { return texture }
    texture = {}
    texture.tex = system.gl.createTexture()
    accessWebcam().then(v => {
      texture.width = v.videoWidth
      texture.height = v.videoHeight
    })
    texture.update = (state) => {
      if (state.time === lastUpdateTime) { return }
      lastUpdateTime = state.time
      system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, texture.width, texture.height, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, video)
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
      shader.texture = getWebcamTexture()
    }
    return shader
  }
})
