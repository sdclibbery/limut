'use strict'
define(function (require) {
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')

  let verts = (loc) => {
    let l = -1 + loc.x*2
    let r = l + loc.w*2
    let t = 1 - loc.y*2
    let b = t - loc.h*2
    let har = system.cw / system.ch
    let ihar = 1
    if (har > 2 || har < 1/2) {
      har = Math.sqrt(har)
      ihar = 1/har
    }
    return {
      vtx: new Float32Array([l,t, r,t, l,b, l,b, r,t, r,b]),
      tex: new Float32Array([-har,ihar, har,ihar, -har,-ihar, -har,-ihar, har,ihar, har,-ihar])
    }
  }

  let colour = ({r,g,b,a}, d) => [param(r, d.r), param(g, d.g), param(b, d.b), param(a, d.a)]
  let vec = (v, d) => {
    v = (typeof v === 'number') ? {x:v,y:v} : v
    return [param(v.x, d.x), param(v.y, d.y)]
  }

  let create = (shader, defFore, defBack, params) => {
    let amp = Math.min(param(params.amp, 1), 5)
    if (amp < 0.001) { return }
    let startTime = params.time
    let loc = param(params.loc, {x:0,y:0,w:1,h:1})
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    let rate = param(params.rate, 1)
    let value = parseInt(param(params.value, '0'))
    if (value > 10) { value = value/5 }
    if (Number.isNaN(value)) { value = param(params.value, '0').charCodeAt(0) - 32 }
    let s = shaders(shader)
    let fore = colour(param(params.fore, {}), defFore)
    let back = colour(param(params.back, {}), defBack)
    let pulse = param(params.pulse, 0)
    let sway = param(params.sway, 0)
    let scroll = vec(param(params.scroll, {}), {x:0,y:0})
    let zoom = vec(param(params.zoom, {}), {x:1,y:1})
    let pixellate = param(params.pixellate, 0)
    let perspective = param(params.perspective, 0)

    if (!s) { return () => {} }
    return state => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*param(params.fade, 0)
      let vtxData = verts(loc)
      let spec = state.spectrum[0]*state.spectrum[0] + state.spectrum[3]*state.spectrum[3]
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, state.count*rate + sway*spec, 1)
      system.gl.uniform1f(s.brightnessUnif, brightness, 1)
      system.gl.uniform1f(s.valueUnif, value + pulse*spec, 1)
      system.gl.uniform1f(s.ampUnif, amp + pulse*spec*0.5, 1)
      system.gl.uniform4fv(s.foreUnif, fore, 1)
      system.gl.uniform4fv(s.backUnif, back, 1)
      system.gl.uniform4fv(s.spectrumUnif, state.spectrum, 1)
      system.gl.uniform2fv(s.scrollUnif, scroll, 1)
      system.gl.uniform2fv(s.zoomUnif, zoom, 1)
      system.gl.uniform1f(s.pixellateUnif, pixellate, 1)
      system.gl.uniform1f(s.perspectiveUnif, perspective, 1)
      if (fore[3] >= 0.9999 && back[3] >= 0.9999) {
        system.gl.disable(system.gl.BLEND)
      } else {
        system.gl.enable(system.gl.BLEND)
        system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      }
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time <= endTime-state.dt+0.01
    }
  }

  return (shader, defFore, defBack) => (params) => {
    system.add(params.time, create(shader, defFore, defBack, params))
  }
})
