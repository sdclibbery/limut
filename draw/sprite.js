'use strict';
define(function (require) {
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')

  let verts = (loc) => {
    let l = -1 + loc.x*2
    let r = l + loc.w*2
    let t = -1 + loc.y*2
    let b = t + loc.h*2
    let har = system.cw / system.ch
    let ihar = 1
    if (har > 2 || har < 1/2) {
      har = Math.sqrt(har)
      ihar = 1/har
    }
    return {
      vtx: new Float32Array([l,t, r,t, l,b, l,b, r,t, r,b]),
      tex: new Float32Array([-har,-ihar, har,-ihar, -har,ihar, -har,ihar, har,-ihar, har,ihar])
    }
  }

  let colour = ({r,g,b,a}, d) => [param(r, d.r), param(g, d.g), param(b, d.b), param(a, d.a)]

  let create = (shader, defFore, defBack, params) => {
    let amp = Math.min(param(params.amp, 1), 2)
    if (amp < 0.001) { return }
    let startTime = params.time
    let l = param(params.loc, {})
    let loc = {
      x: param(l.x, Math.floor(Math.random()*4)/4),
      y: param(l.y, Math.floor(Math.random()*4)/4),
      w: param(l.w, 1/4),
      h: param(l.h, 1/4),
    }
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    let rate = param(params.rate, 1)
    let value = parseInt(param(params.value, '0'))
    if (Number.isNaN(value)) { value = param(params.value, '0').charCodeAt(0) - 32 }
    let s = shaders(shader)
    let fore = colour(param(params.fore, {}), defFore)
    let back = colour(param(params.back, {}), defBack)

    if (!s) { return () => {} }
    return state => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*param(params.fade, 1)
      let vtxData = verts(loc)
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, state.time*rate, 1);
      system.gl.uniform1f(s.brightnessUnif, brightness, 1);
      system.gl.uniform1f(s.valueUnif, value, 1);
      system.gl.uniform1f(s.ampUnif, amp, 1);
      system.gl.uniform4fv(s.foreUnif, fore, 1);
      system.gl.uniform4fv(s.backUnif, back, 1);
      system.gl.enable(system.gl.BLEND)
      system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA);
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time < endTime-state.dt-0.0001
    }
  }

  return (shader, defFore, defBack) => (params) => {
    system.add(params.time, create(shader, defFore, defBack, params))
  }
})
