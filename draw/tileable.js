'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 fragCoordIn;
  varying vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`

  let tiledQuad = () => {
    let l = -1
    let r = 1
    let t = -1
    let b = 1
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

  let programs = {}

  return (fragmentShader, params) => {
    let amp = Math.min(param(params.amp, 1), 2)
    if (amp < 0.001) { return }
    let startTime = params.time
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    let value = parseInt(param(params.value, '0'))
    if (Number.isNaN(value)) { value = param(params.value, '0').charCodeAt(0) - 32 }
    let rate = param(params.rate, 1)
    let envelope = (et) => 1 - Math.sqrt(et)*param(params.fade, 1)

    if (!programs[fragmentShader]) {
      let program = system.loadProgram([
        system.loadShader(vtxShader, system.gl.VERTEX_SHADER),
        system.loadShader(fragmentShader, system.gl.FRAGMENT_SHADER)
      ])
      programs[fragmentShader] = {
        program: program,
        posBuf: system.gl.createBuffer(),
        posAttr: system.gl.getAttribLocation(program, "posIn"),
        fragCoordBuf: system.gl.createBuffer(),
        fragCoordAttr: system.gl.getAttribLocation(program, "fragCoordIn"),
        timeUnif: system.gl.getUniformLocation(program, "iTime"),
        brightnessUnif: system.gl.getUniformLocation(program, "brightness"),
        valueUnif: system.gl.getUniformLocation(program, "value"),
        ampUnif: system.gl.getUniformLocation(program, "amp"),
      }
    }
    let s = programs[fragmentShader]
    return state => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      let brightness = envelope(eventTime)
      let vtxData = tiledQuad()
      system.loadVertexAttrib(s.posBuf, s.posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(s.fragCoordBuf, s.fragCoordAttr, vtxData.tex, 2)
      system.gl.useProgram(s.program)
      system.gl.uniform1f(s.timeUnif, state.time*rate, 1);
      system.gl.uniform1f(s.brightnessUnif, brightness, 1);
      system.gl.uniform1f(s.valueUnif, value, 1);
      system.gl.uniform1f(s.ampUnif, amp, 1);
      system.gl.disable(system.gl.BLEND)
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time < endTime
    }
  }
})
