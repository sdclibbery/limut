'use strict';
define(function (require) {
  let system = require('draw/system')
  let {subParam,mainParam} = require('player/sub-param')

  let texts = {}
  
  return (data) => {
    let key = JSON.stringify(data)
    if (!texts[key]) {
      let str = mainParam(data, 'Blah')
      if (typeof str !== 'string') { str = str.toString() }
      let text = {
        width:512,
        height:512,
      }
      text.tex = system.gl.createTexture()
      texts[key] = text
      let canvas = document.getElementById('text-canvas')
      canvas.width = 512
      canvas.height = 512
      let ctx = canvas.getContext('2d')
      ctx.fillStyle = 'rgba(255, 255, 255, 0.01)'
      ctx.fillRect(0,0,canvas.width,canvas.height)
      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'
      ctx.textAlign = 'center'
      let font = subParam(data, 'font', 'monospace')
      let fontsize = subParam(data, 'size', 72)
      let fontstyle = subParam(data, 'style', '')
      ctx.font = `${fontstyle} ${fontsize}px ${font}`
      let lineHeight = ctx.measureText('Mg').width * subParam(data, 'linesize', 1)*0.9
      let lines = str.split('\n')
      let x = canvas.width * subParam(data, 'x', 1/2)
      let y = canvas.height * (1 - subParam(data, 'y', 1/2)) - lineHeight*Math.floor((lines.length-1)/2)
      for (let i = 0; i < lines.length; ++i) {
        ctx.fillText(lines[i], x, y)
        y += lineHeight
      }
      system.gl.bindTexture(system.gl.TEXTURE_2D, text.tex)
      system.gl.texImage2D(system.gl.TEXTURE_2D, 0, system.gl.RGBA, text.width, text.height, 0, system.gl.RGBA, system.gl.UNSIGNED_BYTE, canvas)
    }
    texts[key].lastUsed = system.time
    for (let k in texts) {
      if (texts[k].lastUsed < system.time-1) { // Cleanup textures not used for 1s or more
        system.gl.deleteTexture(texts[k].tex)
        delete texts[k]
      }
    }
    return texts[key]
  }
})