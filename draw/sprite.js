'use strict'
define(function (require) {
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')
  let evalParam = require('player/eval-param').evalParamFrame
  let texture = require('draw/texture')

  let evalParamFrame = (params, p, def, count) =>{
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v = evalParam(v, params, count)
    if (typeof v !== 'number' && !v) { return def }
    return v
  }
  let evalParamEvent = (params, p, def) =>{
    let v = params[p]
    if (typeof v !== 'number' && !v) { return def }
    v =  evalParam(v, params, params.beat.count)
    if (typeof v !== 'number' && !v) { return def }
    return v
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
  let ca = (n) => {
    if (cachedObjects[n] === undefined) { cachedObjects[n] = [] }
    return cachedObjects[n]
  }
  let colour = ({r,g,b,a}, d, name) => {
    let ar = ca(name)
    ar[0] = param(r, d.r)
    ar[1] = param(g, d.g)
    ar[2] = param(b, d.b)
    ar[3] = param(a, d.a)
    return ar
  }
  let vec = (v, d, name) => {
    let a = ca(name)
    if (typeof v === 'number') {
      a[0] = v
      a[1] = v
    } else {
      a[0] = param(v.x, d.x)
      a[1] = param(v.y, d.y)
    }
    return a
  }
  let rect = (v, d, name) => {
    let o = co(name)
    o.x = param(v.x, d.x)
    o.y = param(v.y, d.y)
    o.w = param(v.w, d.w)
    o.h = param(v.h, d.h)
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
    let endTime = params._time + evalParamEvent(params, 'sus', evalParamEvent(params, 'dur', 1)) * params.beat.duration
    params.endTime = endTime
    let rate = evalParamEvent(params, 'rate', 1)
    let timeParam = params._time
    let value = parseInt(evalParamEvent(params, 'value', '0'))
    if (value > 10) { value = value/5 }
    if (Number.isNaN(value)) { value = evalParamEvent(params, 'value', '0').charCodeAt(0) - 32 }
    let pulse = evalParamEvent(params, 'pulse', 0)
    let sway = evalParamEvent(params, 'sway', 0)
    let additive = evalParamEvent(params, 'additive', defParams.additive || 0)
    let url = evalParamEvent(params, 'url', 'favicon-32x32.png')
    let window = evalParamEvent(params, 'window', false)
    let fade = evalParamEvent(params, 'fade', defParams.fade || 0)
    return state => { // per frame
      if (state.time > endTime) { return false }
      let shaderTime = evalParamFrame(params, 'time', null, state.count)
      if (shaderTime === null) {
        shaderTime = state.count*rate + sway*state.pulse
      }
      let amp = Math.min(evalParamFrame(params, 'amp', 1, state.count), 5)
      let add = evalParamFrame(params, 'add', 1, state.count)
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*fade
      let monochrome = evalParamFrame(params, 'monochrome', 0, state.count)
      let pixellate = evalParamFrame(params, 'pixellate', 0, state.count)
      let vignette = evalParamFrame(params, 'vignette', 0, state.count)
      let loc = rect(evalParamFrame(params, 'loc', blankObj, state.count), defLoc, 'loc')
      let scroll = vec(evalParamFrame(params, 'scroll', blankObj, state.count), defScroll, 'scroll')
      let zoom = vec(evalParamFrame(params, 'zoom', blankObj, state.count), defZoom, 'zoom')
      let perspective = evalParamFrame(params, 'perspective', 0, state.count)
      let tunnel = evalParamFrame(params, 'tunnel', 0, state.count)
      let rotate = evalParamFrame(params, 'rotate', 0, state.count) * Math.PI*2
      let mirror = evalParamFrame(params, 'mirror', 0, state.count)
      let fore = colour(evalParamFrame(params, 'fore', blankObj, state.count), defFore, 'fore')
      let back = colour(evalParamFrame(params, 'back', blankObj, state.count), defBack, 'back')
      let mid
      if (params.mid === undefined) {
        mid = ca('mid')
        for (let i=0; i<4; i++) { mid[i] = (fore[i]+back[i])/2 }
      } else {
        mid = colour(evalParamFrame(params, 'mid', blankObj, state.count), defMid, 'mid')
      }
      let vtxData = verts(loc, window)
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, shaderTime)
      system.gl.uniform1f(s.brightnessUnif, brightness)
      system.gl.uniform1f(s.monochromeUnif, monochrome)
      system.gl.uniform1f(s.vignetteUnif, vignette)
      system.gl.uniform1f(s.valueUnif, value+add + pulse*state.pulse)
      system.gl.uniform1f(s.ampUnif, amp + pulse*state.pulse*0.5)
      system.gl.uniform4fv(s.foreUnif, fore)
      system.gl.uniform4fv(s.midUnif, mid)
      system.gl.uniform4fv(s.backUnif, back)
      system.gl.uniform4fv(s.spectrumUnif, state.spectrum)
      system.gl.uniform2fv(s.scrollUnif, scroll)
      system.gl.uniform2fv(s.zoomUnif, zoom)
      system.gl.uniform1f(s.rotateUnif, rotate)
      system.gl.uniform1f(s.mirrorUnif, mirror)
      system.gl.uniform1f(s.pixellateUnif, pixellate)
      system.gl.uniform1f(s.tunnelUnif, tunnel)
      system.gl.uniform1f(s.perspectiveUnif, perspective)
      system.gl.uniform1f(s.additiveUnif, additive)
      system.gl.uniform1f(s.eventTimeUnif, eventTime)
      if (s.textureUnif) {
        s.textureUnif.forEach((tu,i) => {
          let t = s.texture || texture(url)
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
      if (fore[3] >= 0.9999 && back[3] >= 0.9999 && mid[3] >= 0.9999 && additive == 0 && vignette == 0) {
        system.gl.disable(system.gl.BLEND)
      } else {
        system.gl.enable(system.gl.BLEND)
        system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      }
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return true
    }
  }

  let emptyObject = {}
  return (shader, defFore, defBack, defParams) => (params) => {
    let zorder = param(params.zorder, param(params.linenum, 0)/1000)
    system.add(params._time, play(shader, defFore, defBack, params, defParams || emptyObject), zorder)
  }
})
