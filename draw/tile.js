'use strict';
define(function (require) {
  let system = require('draw/system')
  let shaders = require('draw/shaders')
  let param = require('player/default-param')

  let tiledQuad = (tile) => {
    let l = -1 + tile.x*2
    let r = l + tile.w*2
    let t = -1 + tile.y*2
    let b = t + tile.h*2
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

  let create = (params) => {
    let amp = Math.min(param(params.amp, 1), 2)
    if (amp < 0.001) { return }
    let startTime = params.time
    let ts = param(params.tile, {})
    let tile = {
      x: param(ts.x, Math.floor(Math.random()*4)/4),
      y: param(ts.y, Math.floor(Math.random()*4)/4),
      w: param(ts.w, 1/4),
      h: param(ts.h, 1/4),
    }
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    let rate = param(params.rate, 1)
    let value = parseInt(param(params.value, '0'))
    if (Number.isNaN(value)) { value = param(params.value, '0').charCodeAt(0) - 32 }
    let fore = [1,1,1,1]
    let back = [0.2,0.2,1,1]

    let s = shaders(params)
    if (!s) { return () => {} }
    return state => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = 1 - (eventTime*eventTime)*param(params.fade, 1)
      let vtxData = tiledQuad(tile)
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

  return (params) => {
    system.add(params.time, create(params))
  }
})
