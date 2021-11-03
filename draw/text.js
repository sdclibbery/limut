'use strict';
define(function (require) {
  let system = require('draw/system')

  let texts = {}
  
  return (value) => {
    if (!texts[value]) {
      let text = {
          width:512,
          height:512,
      }
      text.tex = system.gl.createTexture()
      texts[value] = text
      let canvas = document.getElementById('text-canvas')
      canvas.width = 512
      canvas.height = 512
      let ctx = canvas.getContext('2d')
      ctx.fillStyle = "rgba(255, 255, 255, 0.01)"
      ctx.fillRect(0,0,canvas.width,canvas.height)
      ctx.fillStyle = "rgba(255, 255, 255, 1.0)"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.font = "72px monospace"
      ctx.fillText(value, canvas.width/2, canvas.height/2)
      system.gl.bindTexture(system.gl.TEXTURE_2D, text.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, text.width, text.height, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, canvas)
    }
    return texts[value]
  }
})