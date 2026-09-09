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
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { foreback = 0.0; c.a = 0.0; }
    postprocess(c, foreback);
  }
  `

  let firstTime = true
  let videoDevices
  let getDevices = async () => {
    let priming = await navigator.mediaDevices.getUserMedia({ video: true }) // Ask for user permission
    videoDevices = await navigator.mediaDevices.enumerateDevices() // Enumerate all devices
    videoDevices = videoDevices.filter(device => device.kind === 'videoinput')
    // Release the priming stream. A browser will not renegotiate the capture format of a device that
    // already has a live session on it, so leaving this open pins every later request to whatever
    // default the OS picked - typically the biggest, slowest mode the camera has - and quietly
    // downscales it to whatever size was asked for, which is latency for nothing.
    priming.getTracks().forEach(t => t.stop())
    if (firstTime) {
      firstTime = false
      videoDevices.forEach((device,idx) => { consoleOut(`: Found Webcam: ${idx}: ${device.label}`) })
    }
  }

  let defaultWidth = 640
  let defaultHeight = 480
  let defaultFps = 60

  // Latency is mostly decided by the capture mode, so ask for one precisely. An explicit width or
  // height is exact, so a size the camera does not have fails loudly instead of being scaled down
  // from a larger, slower mode; the defaults stay ideal so the no-args case can never break. A high
  // ideal frameRate picks the fastest mode the camera offers, and resizeMode 'none' asks for the
  // native frame rather than a crop-and-scale of a different one.
  //
  // getSettings is logged because a request and a result are not the same thing: resizeMode coming
  // back as 'crop-and-scale' means the size in use is not a native mode, and a bigger one is being
  // captured and downscaled to fake it.
  let accessWebcam = async (deviceIdx, width, height, fps) => {
    let deviceId = videoDevices[deviceIdx].deviceId
    let size = (v, dflt) => v !== undefined ? {exact: v} : {ideal: dflt}
    let constraints = { video: {
      deviceId: {exact: deviceId},
      width: size(width, defaultWidth),
      height: size(height, defaultHeight),
      frameRate: {ideal: fps !== undefined ? fps : defaultFps},
      resizeMode: {ideal: 'none'},
    } }
    let mediaStream = await navigator.mediaDevices.getUserMedia(constraints) // Request specific device
    let track = mediaStream.getTracks()[0]
    let s = (typeof track.getSettings === 'function') ? track.getSettings() : {}
    let scaled = s.resizeMode === 'crop-and-scale' ? ' (scaled, not a native mode)' : ''
    consoleOut(`: Using Webcam: ${track.label} ${s.width}x${s.height} @${Math.round(s.frameRate || 0)}fps${scaled}`)
    let video = document.createElement('video')
    video.ready = false
    video.addEventListener('playing', () => { video.ready = true })
    video.srcObject = mediaStream
    video.stream = mediaStream
    video.setAttribute('playsinline', true)
    video.onloadedmetadata = (e) => {
      video.play()
    }
    return video
  }

  let closeVideo = (video) => {
    video.pause()
    if (video.stream) { video.stream.getTracks().forEach(t => t.stop()) }
    video.srcObject = null
  }

  let getWebcamTexture = (deviceIdx) => {
    let texture = {}
    texture.tex = system.gl.createTexture()
    let video
    let lastUpdateTime
    // Upload when the camera has a new frame rather than once per rendered frame: at 60Hz rAF with a
    // 30fps camera half the texImage2D calls were re-uploading a byte identical image, colour
    // converting the whole frame again on the main thread each time. requestVideoFrameCallback is
    // only trusted once it has actually fired, so a browser without it - or a video element it does
    // not run for - falls back to the old per-frame upload rather than freezing.
    let newFrame = false
    let useFrameCallback = false
    let generation = 0 // Guards a slow getUserMedia resolving after a newer request has superseded it
    let frames = 0
    let measureStart = 0
    let reportedFps = 0

    // Report the frame rate actually being delivered, because getSettings can simply be wrong: a
    // camera that advertises 30fps hands over 20 when auto exposure lengthens the integration time
    // to suit a dim room, and every one of those missing frames is latency. Resolution does not
    // change it, so a rate well under the claimed one means the room, not the mode. Only spoken up
    // for when it changes, so it is quiet once settled but tracks the light going up or down.
    let measure = () => {
      if (measureStart === 0) { measureStart = performance.now(); return }
      if (++frames < 60) { return }
      let fps = frames/((performance.now() - measureStart)/1000)
      if (Math.abs(fps - reportedFps) > 1) {
        reportedFps = fps
        consoleOut(`: Webcam delivering ${fps.toFixed(1)}fps`)
      }
      frames = 0
      measureStart = performance.now()
    }

    // Open, or reopen, the stream. The texture object itself is stable across a reconfigure, so
    // anything already holding it - a compiled visualsynth program's texture list, a cached sprite
    // shader - keeps working and simply starts seeing the new mode.
    texture.reconfigure = (width, height, fps) => {
      if (generation > 0 && texture.reqWidth === width && texture.reqHeight === height && texture.reqFps === fps) { return }
      texture.reqWidth = width
      texture.reqHeight = height
      texture.reqFps = fps
      let gen = ++generation
      if (video) { closeVideo(video) }
      video = undefined
      newFrame = false
      useFrameCallback = false
      frames = 0
      measureStart = 0
      reportedFps = 0
      accessWebcam(deviceIdx, width, height, fps).then(v => {
        if (gen !== generation) { closeVideo(v); return } // Superseded while we were waiting
        video = v
        if (typeof v.requestVideoFrameCallback === 'function') {
          let onFrame = () => {
            if (gen !== generation) { return }
            newFrame = true
            useFrameCallback = true
            measure()
            v.requestVideoFrameCallback(onFrame)
          }
          v.requestVideoFrameCallback(onFrame)
        }
      }).catch(err => {
        consoleOut(`🔴 Webcam error: '${err.message}'`)
      })
    }

    texture.update = (state) => {
      if (!video || !video.ready) { return }
      if (useFrameCallback) {
        if (!newFrame) { return }
        newFrame = false
      } else if (state.time === lastUpdateTime) { return }
      texture.video = video
      texture.width = video.videoWidth
      texture.height = video.videoHeight
      lastUpdateTime = state.time
      system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, texture.width, texture.height, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, video)
    }
    return texture
  }

  let webcamTextures = {}
  let resolveDeviceIdx = (device) => {
    let deviceIdx = device || 0
    if (typeof deviceIdx === 'string') {
      let deviceLabel = deviceIdx
      deviceIdx = videoDevices.findIndex(d => d.label.toLowerCase().includes(deviceLabel.toLowerCase()))
      if (deviceIdx === -1) {
        deviceIdx = 0
        if (webcamTextures[deviceIdx] === undefined) {
          consoleOut(`🟠 Unable to find webcam with label containing ${deviceLabel}`)
        }
      }
    }
    return deviceIdx % videoDevices.length
  }

  // Returns a per-device cached texture object, or undefined until device enumeration completes.
  // Called on every event, so a width/height/fps edited on a live line reopens the camera in the new
  // mode; an unchanged request is a no-op.
  let acquireTexture = (device, width, height, fps) => {
    if (videoDevices === undefined) {
      getDevices()
      return undefined
    }
    let deviceIdx = resolveDeviceIdx(device)
    if (webcamTextures[deviceIdx] === undefined) {
      webcamTextures[deviceIdx] = getWebcamTexture(deviceIdx)
    }
    webcamTextures[deviceIdx].reconfigure(width, height, fps)
    return webcamTextures[deviceIdx]
  }

  let devices = {}
  let renderer = (params) => {
    if (videoDevices === undefined) {
      getDevices()
      return
    }
    let deviceIdx = resolveDeviceIdx(evalParamEvent(params.device, params) || 0)
    if (devices[deviceIdx] === undefined) {
      devices[deviceIdx] = {}
      let device = devices[deviceIdx]
      if (!device.vtxCompiled) {
        device.vtxCompiled = system.loadShader(common.vtxShader, system.gl.VERTEX_SHADER)
      }
      device.shader = {}
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
      device.shader.program = program || null
      common.getCommonUniforms(device.shader)
    }
    // Outside the shader cache above: the mode is resolved every event, not just the first one
    devices[deviceIdx].shader.texture = acquireTexture(
      deviceIdx,
      evalParamEvent(params.width, params),
      evalParamEvent(params.height, params),
      evalParamEvent(params.fps, params))
    return devices[deviceIdx].shader
  }
  renderer.acquireTexture = acquireTexture
  return renderer
})
