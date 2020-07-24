'use strict'
define((require) => {

let system = {
  time: 0,
  gl: null,
  cw: 1,
  ch: 1,
}

system.frameStart = (t, gl, cw, ch) => {
  this.time = t
  if (!this.gl) {
    this.gl = gl
  }
  this.cw = cw
  this.ch = ch

  this.gl.clearColor(0.1, 0.15, 0.2, 1)
  this.gl.enable(this.gl.DEPTH_TEST)
  this.gl.depthFunc(this.gl.LEQUAL)
  this.gl.clear(this.gl.COLOR_BUFFER_BIT|this.gl.DEPTH_BUFFER_BIT)
}

system.xFromCanvas = (x) => {
  return (x*2 - this.cw) / this.ch
}
system.yFromCanvas = (y) => {
  return 1 - y*2/this.ch
}
system.toX = (x) => {
  return x * this.ch / this.cw
}

system.squareVtxs = (x, y, size) => {
  let hs = size/2
  let l = this.toX(x - hs)
  let r = this.toX(x + hs)
  let b = y - hs
  let t = y + hs
  return {
    vtx: new Float32Array([
      l, t,
      r, t,
      l, b,
      l, b,
      r, t,
      r, b]),
    tex: new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      0.0, 1.0,
      1.0, 0.0,
      1.0, 1.0
    ])}
}

system.createIndexBuffer = (indexes) => {
  let buffer = this.gl.createBuffer()
  this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, buffer)
  this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, indexes, this.gl.STATIC_DRAW)
  return buffer
}

system.loadVertexAttrib = (buffer, attr, data, stride) => {
  this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
  this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW)
  this.gl.enableVertexAttribArray(attr)
  this.gl.vertexAttribPointer(attr, stride, this.gl.FLOAT, false, 0, 0)
}

system.loadShader = function(shaderSource, shaderType) {
  let gl = this.gl
  let shader = gl.createShader(shaderType)

  gl.shaderSource(shader, shaderSource)
  gl.compileShader(shader)

  let compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
  if (!compiled) {
    throw("*** Error compiling shader :" + gl.getShaderInfoLog(shader) + "\nSource: " + shaderSource)
    gl.deleteShader(shader)
    return null
  }

  return shader
}

system.loadProgram = function(shaders, opt_attribs, opt_locations) {
  let gl = this.gl
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
