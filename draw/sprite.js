'use strict'
define(function (require) {
  let consoleOut = require('console')
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')
  let evalParam = require('player/eval-param')
  let {subParam,subParamUnits,mainParamUnits} = require('player/sub-param')
  let texture = require('draw/texture')
  let textTexture = require('draw/text')
  let {colour} = require('draw/colour')
  let players = require('player/players')

  let evalMainParamFrame = (params, p, def, count, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamFrame(v, params, count)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }
  let evalSubParamFrame = (params, p, sub, def, count, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamFrame(v, params, count)
    if (v === undefined) { return def }
    return subParamUnits(v, sub, units, def)
  }
  let evalMainParamEvent = (params, p, def, units) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParamUnits(v, units, def)
  }

  let vtxData = {
    vtx: new Float32Array(12),
    tex: new Float32Array(12),
  }
  let verts = (loc, window, har, allowHarAdjust) => {
    let l = loc.x - loc.w/2
    let r = l + loc.w
    let t = loc.y - loc.h/2
    let b = t + loc.h
    let ihar = 1
    if (allowHarAdjust && (har > 2 || har < 1/2)) {
      har = Math.sqrt(har)
      ihar = 1/har
    }
    let u = -har
    let v = -ihar
    let w = har
    let x = ihar
    if (window) {
      u = har*l
      v = ihar*t
      w = har*r
      x = ihar*b
    }
    vtxData.vtx[0] = l
    vtxData.vtx[1] = t
    vtxData.vtx[2] = r
    vtxData.vtx[3] = t
    vtxData.vtx[4] = l
    vtxData.vtx[5] = b
    vtxData.vtx[6] = l
    vtxData.vtx[7] = b
    vtxData.vtx[8] = r
    vtxData.vtx[9] = t
    vtxData.vtx[10] = r
    vtxData.vtx[11] = b
    vtxData.tex[0] = u
    vtxData.tex[1] = v
    vtxData.tex[2] = w
    vtxData.tex[3] = v
    vtxData.tex[4] = u
    vtxData.tex[5] = x
    vtxData.tex[6] = u
    vtxData.tex[7] = x
    vtxData.tex[8] = w
    vtxData.tex[9] = v
    vtxData.tex[10] = w
    vtxData.tex[11] = x
    return vtxData
  }

  let cachedObjects = {}
  let co = (n) => {
    if (cachedObjects[n] === undefined) { cachedObjects[n] = {} }
    return cachedObjects[n]
  }
  let ca = (n, x,y,z,w) => {
    if (cachedObjects[n] === undefined) { cachedObjects[n] = [] }
    let ar = cachedObjects[n]
    if (x !== undefined) { ar[0] = x }
    if (y !== undefined) { ar[1] = y }
    if (z !== undefined) { ar[2] = z }
    if (w !== undefined) { ar[3] = w }
    return ar
  }
  let vec = (v, d, name) => {
    let a = ca(name)
    if (typeof v === 'number') {
      a[0] = v
      a[1] = v
    } else {
      a[0] = subParam(v, 'x', d.x)
      a[1] = subParam(v, 'y', d.y)
    }
    return a
  }
  let rect = (v, d, name) => {
    let o = co(name)
    o.x = subParam(v, 'x', d.x)
    o.y = subParam(v, 'y', d.y)
    o.w = subParam(v, 'w', d.w)
    o.h = subParam(v, 'h', d.h)
    return o
  }
  let recols = {
    oil: 1,
    hue: 2,
    fire: 3,
    sunset: 4,
    neon: 5,
    titanium: 6,
  }

  let defFore = {r:1,g:1,b:1,a:1}
  let defBack = {r:0,g:0,b:0,a:0}
  let defLoc = {x:0,y:0,w:2,h:2}
  let defScroll = {x:0,y:0}
  let defVignette = {x:0,y:0}
  let defZoom = {x:1,y:1}
  let defMid = {r:0,g:0,b:0,a:1}
  let play = (renderer, params) => {
    let s
    if (typeof renderer === 'function') {
      s = renderer(params)
    } else {
      s = shaders(renderer)
    }
    if (!s) { return () => {} }
    let startTime = params._time
    if (params._noteOff === undefined) {
      params.endTime = params._time + evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 1, 'b'), 'b') * params.beat.duration
    } else { // "live" envelope, use note off to determine when to release
      params.endTime = params._time + 1e6
      params._noteOff = () => { params.endTime = system.time+0.01 } // Set real end time to end the event
    }
    let rate = evalMainParamEvent(params, 'rate', 1)
    let value = parseInt(evalMainParamEvent(params, 'value', '0'))
    if (value > 10) { value = value/5 }
    if (Number.isNaN(value)) { value = evalMainParamEvent(params, 'value', '0').charCodeAt(0) - 32 }
    let pulse = evalMainParamEvent(params, 'pulse', 0)
    let sway = evalMainParamEvent(params, 'sway', 0)
    let additive = evalMainParamEvent(params, 'additive', 0)
    let blend = evalMainParamEvent(params, 'blend')
    let url = evalMainParamEvent(params, 'url', 'favicon-32x32.png')
    let text = evalParam.evalParamEvent(params['text'], params)
    let window = evalMainParamEvent(params, 'window', false)
    let fade = evalMainParamEvent(params, 'fade', 0)
    let recolType = evalMainParamEvent(params, 'recol')
    let recol = recols[recolType] || 0
    if (!!recolType && !recol) {
      consoleOut(`🔴 Error: Unknown recol type ${recolType}`)
    }
    let targetBufferPlayerId = evalMainParamEvent(params, 'buffer')
    return state => { // per frame
      if (state.time > params.endTime) { return false }
      let bufferPlayer = players.getById(targetBufferPlayerId)
      let buffer = undefined
      if (bufferPlayer && bufferPlayer.buffer && bufferPlayer.buffer.target && bufferPlayer.buffer.target.framebuffer) {
        buffer = bufferPlayer.buffer || undefined
      }
      if (targetBufferPlayerId && !buffer) { return true }
      if (s.preRender) {
        s.preRender(state)
      }
      let shaderTime = evalMainParamFrame(params, 'time', null, state.count, 'b')
      if (shaderTime === null) {
        shaderTime = state.count*rate + sway*state.pulse
      }
      let realTime = state.count
      let amp = Math.min(evalMainParamFrame(params, 'amp', 1, state.count), 5)
      if (amp <= 0.0001) { return true }
      let add = evalMainParamFrame(params, 'add', 0, state.count)
      let eventTime = ((state.time-startTime)/(params.endTime-startTime))
      let brightness = 1
      if (fade > 0) {
        brightness = brightness - (eventTime*eventTime)*fade
      }
      let monochrome = evalMainParamFrame(params, 'monochrome', 0, state.count)
      let pixellateX = evalMainParamFrame(params, 'pixellate', 0, state.count) ||
                        evalSubParamFrame(params, 'pixellate', 'x', 0, state.count)
      let pixellate = ca('pixellate',
        pixellateX,
        evalSubParamFrame(params, 'pixellate', 'y', pixellateX, state.count),
        0,0
      )
      let vignette = ca('vignette',
        evalMainParamFrame(params, 'vignette', 0, state.count),
        evalSubParamFrame(params, 'vignette', 'aspect', 1, state.count),
        evalSubParamFrame(params, 'vignette', 'cutoff', 0.9, state.count),0
      )
      let loc = rect(evalParam.evalParamFrame(params.loc, params, state.count), defLoc, 'loc')
      let repeat = ca('repeat',
        evalMainParamFrame(params, 'repeat', 0, state.count),
        0,
        evalSubParamFrame(params, 'repeat', 'x', 0, state.count),
        evalSubParamFrame(params, 'repeat', 'y', 0, state.count)
      )
      let scroll = vec(evalParam.evalParamFrame(params.scroll, params, state.count), defScroll, 'scroll')
      let zoom = vec(evalParam.evalParamFrame(params.zoom, params, state.count), defZoom, 'zoom')
      let perspective = ca('perspective',
        evalMainParamFrame(params, 'perspective', 0, state.count),
        evalSubParamFrame(params, 'perspective', 'shade', 0, state.count),
        0,0
      )
      let tunnel = evalMainParamFrame(params, 'tunnel', 0, state.count)
      let contrast = evalMainParamFrame(params, 'contrast', 0, state.count)
      let vhs = evalMainParamFrame(params, 'vhs', 0, state.count)
      let ripple = ca('ripple',
        evalMainParamFrame(params, 'ripple', 0, state.count),
        evalSubParamFrame(params, 'ripple', 'scale', 1, state.count),
        0,0
      )
      let rotate = evalMainParamFrame(params, 'rotate', 0, state.count) * Math.PI*2
      let mirror = ca('mirror',
        evalMainParamFrame(params, 'mirror', 0, state.count),
        evalSubParamFrame(params, 'mirror', 'fan', 0, state.count),
        evalSubParamFrame(params, 'mirror', 'rotate', 0, state.count),
        0
      )
      let fore = colour(evalParam.evalParamFrame(params.fore, params, state.count), defFore, 'fore')
      let back = colour(evalParam.evalParamFrame(params.back, params, state.count), defBack, 'back')
      let mid
      if (params.mid === undefined) {
        mid = ca('mid')
        for (let i=0; i<4; i++) { mid[i] = (fore[i]+back[i])/2 }
      } else {
        mid = colour(evalParam.evalParamFrame(params.mid, params, state.count), defMid, 'mid')
      }
      let har = system.cw / system.ch
      if (buffer) { har = buffer.target.width / buffer.target.height }
      let vtxData = verts(loc, window, har, !params.isBufferFeedback) // Never mess with aspect ratio for feedback as it would break the effect
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      let gl = system.gl
      gl.useProgram(s.program)
      gl.uniform1f(s.timeUnif, shaderTime)
      gl.uniform1f(s.realTimeUnif, realTime)
      gl.uniform1f(s.brightnessUnif, brightness)
      gl.uniform1f(s.monochromeUnif, monochrome)
      gl.uniform4fv(s.vignetteUnif, vignette)
      gl.uniform1i(s.recolUnif, recol)
      gl.uniform1f(s.valueUnif, value+add + pulse*state.pulse)
      gl.uniform1f(s.ampUnif, amp + pulse*state.pulse*0.5)
      gl.uniform4fv(s.foreUnif, fore)
      gl.uniform4fv(s.midUnif, mid)
      gl.uniform4fv(s.backUnif, back)
      gl.uniform4fv(s.spectrumUnif, state.spectrum)
      gl.uniform4fv(s.repeatUnif, repeat)
      gl.uniform2fv(s.scrollUnif, scroll)
      gl.uniform2fv(s.zoomUnif, zoom)
      gl.uniform1f(s.rotateUnif, rotate)
      gl.uniform4fv(s.mirrorUnif, mirror)
      gl.uniform4fv(s.pixellateUnif, pixellate)
      gl.uniform1f(s.tunnelUnif, tunnel)
      gl.uniform4fv(s.rippleUnif, ripple)
      gl.uniform4fv(s.perspectiveUnif, perspective)
      gl.uniform1f(s.additiveUnif, additive)
      gl.uniform1f(s.eventTimeUnif, eventTime)
      gl.uniform1f(s.contrastUnif, contrast)
      gl.uniform1f(s.vhsUnif, vhs)
      if (s.textureUnif) {
        s.textureUnif.forEach((tu,i) => {
          let t = s.texture || (text !== undefined ? textTexture(text) : texture(url))
          if (t.update) { t.update(state) }
          gl.activeTexture(gl['TEXTURE'+i])
          gl.bindTexture(gl.TEXTURE_2D, t.tex)
          gl.uniform1i(tu, i)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          if (s.extentsUnif && t.width && t.height) {
            let extents = ca('extents')
            extents[0] = t.width
            extents[1] = t.height
            gl.uniform2fv(s.extentsUnif, extents)
          }
          if (t.params) { t.params() }
        })
      }
      if (fore[3] >= 0.9999 && back[3] >= 0.9999 && mid[3] >= 0.9999 && additive == 0 && vignette == 0 && blend === undefined) {
        gl.disable(gl.BLEND)
      } else {
        gl.enable(gl.BLEND)
        gl.blendEquation(gl.FUNC_ADD)
        if (blend === 'additive') { gl.blendFunc(gl.ONE, gl.ONE) }
        else if (blend === 'subtractive') { gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquationSeparate(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD) }
        else if (blend === 'invert') { gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquationSeparate(gl.FUNC_SUBTRACT, gl.FUNC_ADD) }
        else if (blend === 'average') { gl.blendFunc(gl.CONSTANT_COLOR, gl.CONSTANT_COLOR); gl.blendColor(0.5,0.5,0.5,0.5) }
        else if (blend === 'multiply') { gl.blendFunc(gl.DST_COLOR, gl.ZERO) }
        else if (blend === 'max') { gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD) }
        else if (blend === 'min') { gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquationSeparate(gl.MIN, gl.FUNC_ADD) }
        else if (!blend) {gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) }
        else {
          consoleOut(`🔴 Error: Unknown blend type ${blend}`)
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        }
      }
      if (buffer && buffer.target && buffer.target.framebuffer) {
        gl.viewport(0,0,buffer.target.width,buffer.target.height)
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.target.framebuffer)
      } else {
        gl.viewport(0,0,system.cw,system.ch)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return true
    }
  }

  let create = (renderer) => (params) => {
    let zorder = param(params.zorder, param(params.linenum, 0)/1000)
    let renderTask = play(renderer, params)
    let targetBufferPlayerId = evalMainParamEvent(params, 'buffer')
    let bufferPlayer = players.getById(targetBufferPlayerId)
    if (bufferPlayer && bufferPlayer.buffer) {
      bufferPlayer.buffer.renderList.add(params._time, renderTask, zorder)
    } else {
      system.add(params._time, renderTask, zorder)
    }
  }

  return {
    create: create,
    play: play,
  }
})
