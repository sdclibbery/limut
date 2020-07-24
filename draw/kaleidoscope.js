'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 texIn;
  varying vec2 tex;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    tex = texIn;
  }`
  let frgShader = `// from https://www.shadertoy.com/view/Xd2Bzw
  precision mediump float;
  varying vec2 tex;
  uniform float time;
  uniform float eventTime;
  void main() {
      float f = fract(time);
      vec2 p = tex;
      p += p * sin(dot(p, p)*20.-time) * .04;
      vec4 c = vec4(0.);
      for (float i = .5 ; i < 8. ; i++) {
        p = abs(2.*fract(p-.5)-1.) * mat2(cos(.01*time*i*i + .78*vec4(1,7,3,1))),
        c += exp(-abs(p.y)*5.) * (cos(vec4(2,3,1,0)*i)*.5+.5);
      }
      c.gb *= .5;
    gl_FragColor = c * vec4(1.-sqrt(eventTime));
  }`

  let program
  let posBuf
  let posAttr
  let texBuf
  let texAttr
  let timeUnif
  let eventTimeUnif
  return (params) => {
    let startTime = params.time
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    if (!program) {
      program = system.loadProgram([
        system.loadShader(vtxShader, system.gl.VERTEX_SHADER),
        system.loadShader(frgShader, system.gl.FRAGMENT_SHADER)
      ])
      posBuf = system.gl.createBuffer()
      posAttr = system.gl.getAttribLocation(program, "posIn")
      texBuf = system.gl.createBuffer()
      texAttr = system.gl.getAttribLocation(program, "texIn")
      timeUnif = system.gl.getUniformLocation(program, "time")
      eventTimeUnif = system.gl.getUniformLocation(program, "eventTime")
    }
    system.add(startTime, (state) => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      system.gl.useProgram(program)
      let vtxData = system.fullscreenVtxs()
      system.loadVertexAttrib(posBuf, posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(texBuf, texAttr, vtxData.tex, 2)
      system.gl.uniform1f(timeUnif, state.time, 1);
      system.gl.uniform1f(eventTimeUnif, eventTime, 1);
      system.gl.enable(system.gl.BLEND)
      system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time < endTime
    })
  }
})
