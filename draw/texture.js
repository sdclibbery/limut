'use strict';
define(function (require) {
  let system = require('draw/system')

  let textures = {}
  
  const defaultPixel = new Uint8Array([0, 0, 0, 255])
  return (url) => {
    if (!textures[url]) {
      let texture = {}
      textures[url] = texture
      texture.tex = system.gl.createTexture()
      system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, 1, 1, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, defaultPixel)
      const image = new Image()
      image.onload = () => {
        system.gl.bindTexture(system.gl.TEXTURE_2D, texture.tex)
        system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, system.gl.RGBA, system.gl.UNSIGNED_BYTE, image)
      }
      image.crossOrigin = "anonymous"
      image.src = url
    }
    return textures[url].tex
  }
})