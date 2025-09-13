'use strict';
define(function (require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')
  let consoleOut = require('console')
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
    if (ar > 1.0) { uv.x /= ar; } else { uv.y *= ar; }
    uv = preprocess(uv);
    uv.y = -uv.y;
    uv = (uv / 2.0) + 0.5;
    vec4 c = texture(l_image, fract(uv));
    float foreback = c.a*(c.r+c.g+c.b)/3.0;
    c.a = 1.0;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { foreback = 0.0; }
    postprocess(c, foreback);
  }
  `

  let firstTime = true
  let videoDevices
  let getDevices = async () => {
    await navigator.mediaDevices.getUserMedia({ video: true }) // Ask for user permission
    videoDevices = await navigator.mediaDevices.enumerateDevices() // Enumerate all devices
    videoDevices = videoDevices.filter(device => device.kind === 'videoinput')
    if (firstTime) {
      firstTime = false
      videoDevices.forEach((device,idx) => { consoleOut(`: Found Webcam: ${idx}: ${device.label}`) })
    }
  }

  let accessWebcam = async (deviceIdx) => {
    let deviceId = videoDevices[deviceIdx].deviceId
    let constraints = { video: { deviceId:{exact: deviceId}, width:{ideal: 512}, height:{ideal: 512} } }
    let mediaStream = await navigator.mediaDevices.getUserMedia(constraints) // Request specific device
    consoleOut(`: Using Webcam: ${mediaStream.getTracks()[0].label}`)
    let video = document.createElement('video')
    video.ready = false
    video.addEventListener('playing', () => { video.ready = true })
    video.srcObject = mediaStream
    video.setAttribute('playsinline', true)
    video.onloadedmetadata = (e) => {
      video.play()
    }
    return video
  }

  let getWebcamTexture = (deviceIdx) => {
    let texture
    let lastUpdateTime
    texture = {}
    texture.tex = system.gl.createTexture()
    let video
    accessWebcam(deviceIdx).then(v => {
      video = v
    }).catch(err => {
      consoleOut(`🔴 Webcam error: '${err.message}'`)
    })
    texture.update = (state) => {
      if (!video || !video.ready || state.time === lastUpdateTime) { return }
      texture.video = video
      texture.width = video.videoWidth
      texture.height = video.videoHeight
      lastUpdateTime = state.time
      system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, texture.width, texture.height, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, video)
    }
    return texture
  }

  let devices = {}
  return (params) => {
    if (videoDevices === undefined) {
      getDevices()
      return
    }
    let deviceIdx = evalParamEvent(params.device, params) || 0
    if (typeof deviceIdx === 'string') {
      deviceIdx = videoDevices.findIndex(d => d.label.includes(deviceIdx)) || 0
    }
    deviceIdx = deviceIdx % videoDevices.length
    if (devices[deviceIdx] === undefined) {
      devices[deviceIdx] = {}
      let device = devices[deviceIdx]
      if (!device.vtxCompiled) {
        device.vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
      }
      let program
      try {
        program = system.loadProgram([
          device.vtxCompiled,
          system.loadShader(fragSource, system.gl.FRAGMENT_SHADER)
        ])
      } catch (e) {
        device.shader.program = null
        throw e
      }
      device.shader = {}
      device.shader.program = program || null
      common.getCommonUniforms(device.shader)
      device.shader.texture = getWebcamTexture(deviceIdx)
    }
    return devices[deviceIdx].shader
  }
})
