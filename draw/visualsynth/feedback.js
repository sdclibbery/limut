'use strict'
define(function(require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')

  // Stands in for the previous frame's texture during the build walk: codegen stays GL free and
  // player free, and the renderer swaps in the real texture for this slot
  let marker = { isFeedbackMarker: true }

  // u_vsfb is the quad's fragCoord bounds (lo.xy, hi.xy), mapping a px coordinate onto the target
  let helper = { name: 'l_pxprev', source: `uniform vec4 u_vsfb;
vec4 l_pxprev(sampler2D s, vec4 p) {
  vec2 c = (p.xy - u_vsfb.xy) / (u_vsfb.zw - u_vsfb.xy);
  return all(equal(c, clamp(c, 0.0, 1.0))) ? texture(s, c) : vec4(0.0);
}` }

  let copySource = `#version 300 es
precision highp float;
in vec2 fragCoord;
out vec4 fragColor;
uniform sampler2D u_img;
uniform vec4 u_bounds;
void main() {
  fragColor = texture(u_img, (fragCoord - u_bounds.xy) / (u_bounds.zw - u_bounds.xy));
}`
  let copyShader
  let getCopyShader = () => {
    if (copyShader) { return copyShader }
    let gl = system.gl
    let program = system.loadProgram([
      system.loadShader(common.vtxShader, gl.VERTEX_SHADER),
      system.loadShader(copySource, gl.FRAGMENT_SHADER),
    ])
    copyShader = { program: program }
    common.getCommonUniforms(copyShader)
    copyShader.imgUnif = gl.getUniformLocation(program, 'u_img')
    copyShader.boundsUnif = gl.getUniformLocation(program, 'u_bounds')
    return copyShader
  }

  // 8 bit targets stall a per-frame decay: x*0.97 rounds back to x below about 16/255, leaving a
  // permanent ghost. Half float avoids that where the float colour buffer extension exists.
  let halfFloat
  let createTarget = (w, h) => {
    let gl = system.gl
    if (halfFloat === undefined) { halfFloat = !!gl.getExtension('EXT_color_buffer_float') }
    let tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (halfFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    let framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex: tex, framebuffer: framebuffer, width: w, height: h }
  }
  let deleteTarget = (t) => {
    system.gl.deleteTexture(t.tex)
    system.gl.deleteFramebuffer(t.framebuffer)
  }

  // Kept on the player so the history survives new events and code edits
  let forPlayer = (player) => {
    let fb = (player && player.pxFeedback) || { rt: [], current: 0 }
    if (player) { player.pxFeedback = fb }
    if (!fb.read) {
      fb.read = { get tex() { let t = fb.rt[1 - fb.current]; return t && t.tex } }
    }
    return fb
  }

  let fullQuad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1])
  let bounds = new Float32Array(4)

  // Hooks for sprite.js. prepare runs once the quad is known: it sizes the targets to the quad's
  // pixels, advances the history once per frame (overlapping events share one), and retargets the
  // quad's vertices to fill the feedback target. pass then draws the px into the target and leaves
  // the copy program current with the real quad, for sprite.js's own draw to blend onto the screen.
  let attach = (fb, shader) => {
    let screenVtx = new Float32Array(12)
    let frag = new Float32Array(12)
    return {
      prepare: (state, vtxData, tw, th) => {
        let w = Math.max(1, Math.round(Math.abs(vtxData.vtx[2] - vtxData.vtx[0]) / 2 * tw))
        let h = Math.max(1, Math.round(Math.abs(vtxData.vtx[5] - vtxData.vtx[1]) / 2 * th))
        if (!fb.rt[0] || fb.rt[0].width !== w || fb.rt[0].height !== h) {
          fb.rt.forEach(deleteTarget)
          fb.rt = [createTarget(w, h), createTarget(w, h)]
        }
        if (fb.frame !== state.time) {
          fb.frame = state.time
          fb.current = 1 - fb.current
        }
        screenVtx.set(vtxData.vtx)
        frag.set(vtxData.tex)
        bounds[0] = frag[0]; bounds[1] = frag[1]; bounds[2] = frag[10]; bounds[3] = frag[11]
        vtxData.vtx.set(fullQuad)
      },
      pass: () => {
        let gl = system.gl
        let target = fb.rt[fb.current]
        gl.uniform4fv(shader.feedbackBoundsUnif, bounds)
        gl.disable(gl.BLEND)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
        gl.viewport(0, 0, target.width, target.height)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        let c = getCopyShader()
        gl.useProgram(c.program)
        system.loadVertexAttrib(c.posBuf, c.posAttr, screenVtx, 2)
        system.loadVertexAttrib(c.fragCoordBuf, c.fragCoordAttr, frag, 2)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, target.tex)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.uniform1i(c.imgUnif, 0)
        gl.uniform4fv(c.boundsUnif, bounds)
      },
    }
  }

  return {
    marker: marker,
    helper: helper,
    forPlayer: forPlayer,
    attach: attach,
  }
})
