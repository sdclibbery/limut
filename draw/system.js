'use strict'
define((require) => {
let renderList = require('draw/render-list')

let system = {
  time: 0,
  gl: null,
  cw: 1,
  ch: 1,
  renderList: renderList(),
}

system.add = (startTime, render, zorder) => {
  system.renderList.add(startTime, render, zorder)
}

let state = {}
system.frameStart = (time, count, gl, cw, ch, spectrum, pulse) => {
  system.time = time
  system.dt = system.time - system.lastTime
  system.lastTime = time
  system.cw = cw
  system.ch = ch
  if (!system.gl) {
    system.gl = gl
    system.gl.getExtension('OES_standard_derivatives')
  }
  if (system.renderList.isEmpty()) { return false }

  system.gl.viewport(0,0,cw,ch)
  system.gl.enable(system.gl.DEPTH_TEST)
  system.gl.depthFunc(system.gl.LEQUAL)

  system.gl.clearDepth(1)
  system.gl.clearColor(0,0,0,1)
  system.gl.clear(system.gl.COLOR_BUFFER_BIT|system.gl.DEPTH_BUFFER_BIT)

  state.count = count
  state.time = time
  state.dt = system.dt
  state.spectrum = spectrum
  state.pulse = pulse
  system.renderList.render(state)

  return true
}

system.latency = () => {
  return system.dt
}

system.xFromCanvas = (x) => {
  return (x*2 - system.cw) / system.ch
}
system.yFromCanvas = (y) => {
  return 1 - y*2/system.ch
}
system.toX = (x) => {
  return x * system.ch / system.cw
}

system.createIndexBuffer = (indexes) => {
  let buffer = system.gl.createBuffer()
  system.gl.bindBuffer(system.gl.ELEMENT_ARRAY_BUFFER, buffer)
  system.gl.bufferData(system.gl.ELEMENT_ARRAY_BUFFER, indexes, system.gl.STATIC_DRAW)
  return buffer
}

system.loadVertexAttrib = (buffer, attr, data, stride) => {
  system.gl.bindBuffer(system.gl.ARRAY_BUFFER, buffer)
  system.gl.bufferData(system.gl.ARRAY_BUFFER, data, system.gl.STATIC_DRAW)
  system.gl.enableVertexAttribArray(attr)
  system.gl.vertexAttribPointer(attr, stride, system.gl.FLOAT, false, 0, 0)
}

system.loadShader = function(shaderSource, shaderType) {
  let gl = system.gl
  let shader = gl.createShader(shaderType)

  gl.shaderSource(shader, shaderSource)
  gl.compileShader(shader)

  let compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
  if (!compiled) {
    console.error("*** Error compiling shader :" + gl.getShaderInfoLog(shader) + "\nSource: " + shaderSource)
    gl.deleteShader(shader)
    throw('Shader compilation failure ' + shaderType)
    return null
  }

  return shader
}

system.loadProgram = function(shaders, opt_attribs, opt_locations) {
  let gl = system.gl
  let program = gl.createProgram()
  for (let ii = 0; ii < shaders.length; ++ii) {
    gl.attachShader(program, shaders[ii])
  }
  if (opt_attribs) {
    for (let ii = 0; ii < opt_attribs.length; ++ii) {
      gl.bindAttribLocation(
          program,
          opt_locations ? opt_locations[ii] : ii,
          opt_attribs[ii])
    }
  }
  gl.linkProgram(program)

  let linked = gl.getProgramParameter(program, gl.LINK_STATUS)
  if (!linked) {
      throw("Error in program linking:" + gl.getProgramInfoLog (program))
      gl.deleteProgram(program)
      return null
  }
  return program
}

return system
})
