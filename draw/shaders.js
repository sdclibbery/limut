'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let shaders = {}

  let getUrl = (value) => {
    if (value == '.' || value == ' ') {
      return
    } else {
      return "shader/kaleidoscope.frag"
      //return "shader/"+value.toLowerCase()+".frag"
    }
  }

  return (params) => {
    let url = getUrl(param(params.value, '0'))
    if (url == undefined) { return }
    if (shaders[url] === undefined) {
      let request = new XMLHttpRequest()
      request.open('GET', url, true)
      request.onload = () => {
        shaders[url] = {source: request.response}
      }
      request.send()
    }
    let shader = shaders[url]
    if (shader === undefined) { return }
    if (shader.compiled === undefined && shader.source !== undefined) {
      shader.compiled = system.loadShader(shader.source, system.gl.FRAGMENT_SHADER)
    }
    return shader.compiled
  }
})
