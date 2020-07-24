'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let vtxShader = ""
  +"  attribute vec2 posIn;"
  +"  attribute vec2 texIn;"
  +"  varying vec2 tex;"
  +"  void main() {"
  +"    gl_Position = vec4(posIn, 0, 1);"
  +"    tex = texIn;"
  +"  }"
  let frgShader = ""
  +"  precision mediump float;"
  +"  varying vec2 tex;"
  +"  void main() {"
  +"    gl_FragColor = vec4(1,0,1,1);"
  +"  }"

  let program
  let posBuf
  let posAttr
  let texBuf
  let texAttr
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
    }
    system.add(startTime, (state) => {
      system.gl.useProgram(program)
      var vtxData = system.fullscreenVtxs()
      system.loadVertexAttrib(posBuf, posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(texBuf, texAttr, vtxData.tex, 2)
      system.gl.enable(system.gl.BLEND)
      system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time < endTime
    })
  }
})
