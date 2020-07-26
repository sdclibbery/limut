'use strict'
define((require) => {

let system = {
  time: 0,
  gl: null,
  cw: 1,
  ch: 1,
  queued: [],
  active: [],
}

system.add = (startTime, v) => {
  system.queued.push({t:startTime, v:v})
}

system.frameStart = (time, gl, cw, ch) => {
  system.time = time
  if (!system.gl) {
    system.gl = gl
  }
  system.cw = cw
  system.ch = ch

  system.gl.viewport(0,0,cw,ch)
  system.gl.clearColor(0.125, 0.15, 0.1875, 1)
  system.gl.enable(system.gl.DEPTH_TEST)
  system.gl.depthFunc(system.gl.LEQUAL)
  system.gl.clear(system.gl.COLOR_BUFFER_BIT|system.gl.DEPTH_BUFFER_BIT)

  let state = {time: time}
  let newlyActive = system.queued.filter(({t,v}) => time >= t).map(({t,v}) => v)
  system.active = system.active.concat(newlyActive)
  system.queued = system.queued.filter(({t,v}) => time < t)
  system.active = system.active.filter(v => v(state))
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
