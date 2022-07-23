'use strict'
define(function (require) {
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')
  let evalParam = require('player/eval-param')
  let {subParam,mainParam} = require('player/sub-param')
  let texture = require('draw/texture')
  let textTexture = require('draw/text')
  let colour = require('draw/colour')

  let evalMainParamFrame = (params, p, def, count) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamFrame(v, params, count)
    if (v === undefined) { return def }
    return mainParam(v, def)
  }
  let evalSubParamFrame = (params, p, sub, def, count) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamFrame(v, params, count)
    if (v === undefined) { return def }
    return subParam(v, sub, def)
  }
  let evalMainParamEvent = (params, p, def) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamEvent(v, params)
    if (v === undefined) { return def }
    return mainParam(v, def)
  }
  let evalSubParamEvent = (params, p, sub, def) => {
    let v = params[p]
    if (v === undefined) { return def }
    v = evalParam.evalParamEvent(v, params)
    if (v === undefined) { return def }
    return subParam(v, sub, def)
  }

let vtxData = {
  vtx: new Float32Array(12),
  tex: new Float32Array(12),
}
let verts = (loc, window) => {
    let l = loc.x - loc.w/2
    let r = l + loc.w
    let t = loc.y - loc.h/2
    let b = t + loc.h
    let har = system.cw / system.ch
    let ihar = 1
    if (har > 2 || har < 1/2) {
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

  const blankObj = {}
  let defLoc = {x:0,y:0,w:2,h:2}
  let defScroll = {x:0,y:0}
  let defZoom = {x:1,y:1}
  let defMid = {r:0,g:0,b:0,a:1}
  let play = (shader, defFore, defBack, params, defParams) => {
    let s
    if (typeof shader === 'function') {
      s = shader(params)
    } else {
      s = shaders(shader)
    }
    if (!s) { return () => {} }
    let startTime = params._time
    let endTime = params._time + evalMainParamEvent(params, 'sus', evalMainParamEvent(params, 'dur', 1)) * params.beat.duration
    params.endTime = endTime
    let rate = evalMainParamEvent(params, 'rate', 1)
    let value = parseInt(evalMainParamEvent(params, 'value', '0'))
    if (value > 10) { value = value/5 }
    if (Number.isNaN(value)) { value = evalMainParamEvent(params, 'value', '0').charCodeAt(0) - 32 }
    let pulse = evalMainParamEvent(params, 'pulse', 0)
    let sway = evalMainParamEvent(params, 'sway', 0)
    let additive = evalMainParamEvent(params, 'additive', defParams.additive || 0)
    let blend = evalMainParamEvent(params, 'blend')
    let url = evalMainParamEvent(params, 'url', 'favicon-32x32.png')
    let text = evalParam.evalParamEvent(params['text'], params)
    let window = evalMainParamEvent(params, 'window', false)
    let fade = evalMainParamEvent(params, 'fade', defParams.fade || 0)
    let recol = evalMainParamEvent(params, 'recol', 0)
    return state => { // per frame
      if (state.time > endTime) { return false }
      let shaderTime = evalMainParamFrame(params, 'time', null, state.count)
      if (shaderTime === null) {
        shaderTime = state.count*rate + sway*state.pulse
      }
      let amp = Math.min(evalMainParamFrame(params, 'amp', 1, state.count), 5)
      if (amp === 0) { return true }
      let add = evalMainParamFrame(params, 'add', 0, state.count)
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*fade
      let monochrome = evalMainParamFrame(params, 'monochrome', 0, state.count)
      let pixellateX = evalMainParamFrame(params, 'pixellate', 0, state.count)
      let pixellate = ca('pixellate',
        pixellateX,
        evalSubParamFrame(params, 'pixellate', 'y', pixellateX, state.count),
        0,0
      )
      let vignette = evalMainParamFrame(params, 'vignette', 0, state.count)
      let loc = rect(evalParam.evalParamFrame(params.loc, params, state.count), defLoc, 'loc')
      let repeat = ca('repeat',
        evalMainParamFrame(params, 'repeat', 0, state.count),
        0,
        evalSubParamFrame(params, 'repeat', 'x', 0, state.count),
        evalSubParamFrame(params, 'repeat', 'y', 0, state.count)
      )
      let scroll = vec(evalParam.evalParamFrame(params.scroll, params, state.count), defScroll, 'scroll')
      let zoom = vec(evalParam.evalParamFrame(params.zoom, params, state.count), defZoom, 'zoom')
      let perspective = evalMainParamFrame(params, 'perspective', 0, state.count)
      let tunnel = evalMainParamFrame(params, 'tunnel', 0, state.count)
      let contrast = evalMainParamFrame(params, 'contrast', 0, state.count)
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
      let vtxData = verts(loc, window)
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, shaderTime)
      system.gl.uniform1f(s.brightnessUnif, brightness)
      system.gl.uniform1f(s.monochromeUnif, monochrome)
      system.gl.uniform1f(s.vignetteUnif, vignette)
      system.gl.uniform1i(s.recolUnif, recol)
      system.gl.uniform1f(s.valueUnif, value+add + pulse*state.pulse)
      system.gl.uniform1f(s.ampUnif, amp + pulse*state.pulse*0.5)
      system.gl.uniform4fv(s.foreUnif, fore)
      system.gl.uniform4fv(s.midUnif, mid)
      system.gl.uniform4fv(s.backUnif, back)
      system.gl.uniform4fv(s.spectrumUnif, state.spectrum)
      system.gl.uniform4fv(s.repeatUnif, repeat)
      system.gl.uniform2fv(s.scrollUnif, scroll)
      system.gl.uniform2fv(s.zoomUnif, zoom)
      system.gl.uniform1f(s.rotateUnif, rotate)
      system.gl.uniform4fv(s.mirrorUnif, mirror)
      system.gl.uniform4fv(s.pixellateUnif, pixellate)
      system.gl.uniform1f(s.tunnelUnif, tunnel)
      system.gl.uniform4fv(s.rippleUnif, ripple)
      system.gl.uniform1f(s.perspectiveUnif, perspective)
      system.gl.uniform1f(s.additiveUnif, additive)
      system.gl.uniform1f(s.eventTimeUnif, eventTime)
      system.gl.uniform1f(s.contrastUnif, contrast)
      if (s.textureUnif) {
        s.textureUnif.forEach((tu,i) => {
          let t = s.texture || (text !== undefined ? textTexture(text) : texture(url))
          if (t.update) { t.update(state) }
          system.gl.activeTexture(system.gl['TEXTURE'+i])
          system.gl.bindTexture(system.gl.TEXTURE_2D, t.tex)
          system.gl.uniform1i(tu, i)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_S, system.gl.CLAMP_TO_EDGE)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_T, system.gl.CLAMP_TO_EDGE)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_MIN_FILTER, system.gl.LINEAR)
          if (s.extentsUnif && t.width && t.height) {
            let extents = ca('extents')
            extents[0] = t.width
            extents[1] = t.height
            system.gl.uniform2fv(s.extentsUnif, extents)
          }
          if (t.params) { t.params() }
        })
      }
      let gl = system.gl
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
        else { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) }
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      return true
    }
  }

  let emptyObject = {}
  return (shader, defFore, defBack, defParams) => (params) => {
    let zorder = param(params.zorder, param(params.linenum, 0)/1000)
    system.add(params._time, play(shader, defFore, defBack, params, defParams || emptyObject), zorder)
  }
})
