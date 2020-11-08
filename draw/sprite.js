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
    return {
      vtx: new Float32Array([l,t, r,t, l,b, l,b, r,t, r,b]),
      tex: new Float32Array([u,v, w,v, u,x, u,x, w,v, w,x])
    }
  }

  let colour = ({r,g,b,a}, d) => [param(r, d.r), param(g, d.g), param(b, d.b), param(a, d.a)]
  let vec = (v, d) => {
    v = (typeof v === 'number') ? {x:v,y:v} : v
    return [param(v.x, d.x), param(v.y, d.y)]
  }
  let rect = (v, d) => {
    return {x:param(v.x, d.x), y:param(v.y, d.y), w:param(v.w, d.w), h:param(v.h, d.h)}
  }

  let play = (shader, defFore, defBack, params, defParams) => {
    let s
    if (typeof shader === 'function') {
      s = shader(params)
    } else {
      s = shaders(shader)
    }
    if (!s) { return () => {} }
    let startTime = params.time
    let endTime = params.time + evalParamEvent(params, 'sus', evalParamEvent(params, 'dur', 1)) * params.beat.duration
    params.endTime = endTime
    let rate = evalParamEvent(params, 'rate', 1)
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
      let amp = Math.min(evalParamFrame(params, 'amp', 1, state.count), 5)
      let add = Math.min(evalParamFrame(params, 'add', 1, state.count), 0)
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*fade
      let monochrome = evalParamFrame(params, 'monochrome', 0, state.count)
      let pixellate = evalParamFrame(params, 'pixellate', 0, state.count)
      let loc = rect(evalParamFrame(params, 'loc', {}, state.count), {x:0,y:0,w:2,h:2})
      let scroll = vec(evalParamFrame(params, 'scroll', {}, state.count), {x:0,y:0})
      let zoom = vec(evalParamFrame(params, 'zoom', {}, state.count), {x:1,y:1})
      let perspective = evalParamFrame(params, 'perspective', 0, state.count)
      let rotate = evalParamFrame(params, 'rotate', 0, state.count) * Math.PI*2
      let fore = colour(evalParamFrame(params, 'fore', {}, state.count), defFore)
      let back = colour(evalParamFrame(params, 'back', {}, state.count), defBack)
      let mid
      if (params.mid === undefined) {
        mid = []
        for (let i=0; i<4; i++) { mid[i] = (fore[i]+back[i])/2 }
      } else {
        mid = colour(evalParamFrame(params, 'mid', {}, state.count), {r:0,g:0,b:0,a:1})
      }
      let vtxData = verts(loc, window)
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, state.count*rate + sway*state.pulse)
      system.gl.uniform1f(s.brightnessUnif, brightness)
      system.gl.uniform1f(s.monochromeUnif, monochrome)
      system.gl.uniform1f(s.valueUnif, value+add + pulse*state.pulse)
      system.gl.uniform1f(s.ampUnif, amp + pulse*state.pulse*0.5)
      system.gl.uniform4fv(s.foreUnif, fore)
      system.gl.uniform4fv(s.midUnif, mid)
      system.gl.uniform4fv(s.backUnif, back)
      system.gl.uniform4fv(s.spectrumUnif, state.spectrum)
      system.gl.uniform2fv(s.scrollUnif, scroll)
      system.gl.uniform2fv(s.zoomUnif, zoom)
      system.gl.uniform1f(s.rotateUnif, rotate)
      system.gl.uniform1f(s.pixellateUnif, pixellate)
      system.gl.uniform1f(s.perspectiveUnif, perspective)
      system.gl.uniform1f(s.additiveUnif, additive)
      system.gl.uniform1f(s.eventTimeUnif, eventTime)
      if (s.textureUnif) {
        s.textureUnif.forEach((tu,i) => {
          let t = texture(url)
          system.gl.activeTexture(system.gl['TEXTURE'+i])
          system.gl.bindTexture(system.gl.TEXTURE_2D, t.tex)
          system.gl.uniform1i(tu, i)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_S, system.gl.CLAMP_TO_EDGE)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_WRAP_T, system.gl.CLAMP_TO_EDGE)
          system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_MIN_FILTER, system.gl.LINEAR)
          if (s.extentsUnif && t.width && t.height) {
            system.gl.uniform2fv(s.extentsUnif, [t.width, t.height])
          }
        })
      }
      if (fore[3] >= 0.9999 && back[3] >= 0.9999 && additive == 0) {
        system.gl.disable(system.gl.BLEND)
      } else {
        system.gl.enable(system.gl.BLEND)
        system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      }
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return true
    }
  }

  return (shader, defFore, defBack, defParams) => (params) => {
    let zorder = param(params.zorder, param(params.linenum, 0)/1000)
    system.add(params.time, play(shader, defFore, defBack, params, defParams || {}), zorder)
  }
})
