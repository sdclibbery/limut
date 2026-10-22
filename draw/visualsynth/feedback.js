'use strict'
define(function(require) {
  let system = require('draw/system')
  let common = require('draw/shadercommon')

  // Stands in for the previous frame's texture during the build walk: codegen stays GL free and
  // player free, and the renderer swaps in the real texture for this slot
  let marker = { isFeedbackMarker: true }
  // pxprev{blur:}'s second slot: a blur pyramid of the previous frame, rebuilt once per frame
  let pyramidMarker = { isFeedbackPyramid: true }

  // u_vsfb is the quad's fragCoord bounds (lo.xy, hi.xy), mapping a px coordinate onto the target
  let helper = { name: 'l_pxprev', source: `uniform vec4 u_vsfb;
vec4 l_pxprev(sampler2D s, vec4 p) {
  vec2 c = (p.xy - u_vsfb.xy) / (u_vsfb.zw - u_vsfb.xy);
  return all(equal(c, clamp(c, 0.0, 1.0))) ? texture(s, c) : vec4(0.0);
}` }

  // r is a radius as a fraction of the frame height. The pyramid's level 0 is half size, so below
  // that it fades in from the sharp history, which makes blur:0 exactly pxprev. Needs helper's u_vsfb.
  let lodHelper = { name: 'l_pxprevlod', source: `vec4 l_pxprevlod(sampler2D s, sampler2D m, vec4 p, float r) {
  vec2 c = (p.xy - u_vsfb.xy) / (u_vsfb.zw - u_vsfb.xy);
  vec2 cm = c * vec2(textureSize(s, 0)) / (2.0 * vec2(textureSize(m, 0)));
  float lod = log2(max(2.0 * r * float(textureSize(s, 0).y), 1.0));
  vec4 v = lod < 1.0 ? mix(texture(s, c), textureLod(m, cm, 0.0), lod) : textureLod(m, cm, lod - 1.0);
  return all(equal(c, clamp(c, 0.0, 1.0))) ? v : vec4(0.0);
}` }

  // Each pyramid level is a tent filtered reduction of the one above, the tent as wide as the
  // stride. Any narrower or fixed footprint (generateMipmap's 2x2 box, a dual filter's taps) weights
  // texels unevenly when a level is not exactly half the one above, so a small light's glow pulses
  // as it moves. Level 0 is padded so the first levels do halve exactly, where the tent is four
  // bilinear taps; the small levels below that take the general loop.
  let downSource = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_src;
uniform vec2 u_dst;
uniform bool u_exact;
void main() {
  vec2 size = vec2(textureSize(u_src, 0));
  if (u_exact) {
    vec2 p = gl_FragCoord.xy * 2.0;
    fragColor = 0.25 * (texture(u_src, (p + vec2(-0.75, -0.75)) / size) + texture(u_src, (p + vec2(0.75, -0.75)) / size)
      + texture(u_src, (p + vec2(-0.75, 0.75)) / size) + texture(u_src, (p + vec2(0.75, 0.75)) / size));
    return;
  }
  vec2 s = size / u_dst;
  vec2 c = gl_FragCoord.xy * s;
  ivec2 lo = ivec2(ceil(c - s - 0.5));
  ivec2 hi = ivec2(floor(c + s - 0.5));
  ivec2 top = ivec2(size) - 1;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int y = lo.y; y <= hi.y; y++) {
    for (int x = lo.x; x <= hi.x; x++) {
      vec2 w = max(1.0 - abs(vec2(x, y) + 0.5 - c) / s, 0.0);
      float k = w.x * w.y;
      sum += k * texelFetch(u_src, clamp(ivec2(x, y), ivec2(0), top), 0);
      total += k;
    }
  }
  fragColor = sum / total;
}`
  let downVtx = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`

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

  let downShader
  let getDownShader = () => {
    if (downShader) { return downShader }
    let gl = system.gl
    let program = system.loadProgram([
      system.loadShader(downVtx, gl.VERTEX_SHADER),
      system.loadShader(downSource, gl.FRAGMENT_SHADER),
    ])
    downShader = {
      program: program,
      posAttr: gl.getAttribLocation(program, 'pos'),
      posBuf: gl.createBuffer(),
      srcUnif: gl.getUniformLocation(program, 'u_src'),
      dstUnif: gl.getUniformLocation(program, 'u_dst'),
      exactUnif: gl.getUniformLocation(program, 'u_exact'),
    }
    return downShader
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
  let createPyramid = (w, h) => {
    let gl = system.gl
    // Level 0 covers 2*w0 x 2*h0 history pixels, the excess clamped to the edge; multiples of 32
    // make it and the next five levels exact halves
    let w0 = Math.ceil(w/64)*32, h0 = Math.ceil(h/64)*32
    let count = Math.floor(Math.log2(Math.max(w0, h0))) + 1
    let tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texStorage2D(gl.TEXTURE_2D, count, halfFloat ? gl.RGBA16F : gl.RGBA8, w0, h0)
    let levels = []
    for (let l = 0; l < count; l++) {
      let framebuffer = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, l)
      levels.push({ framebuffer: framebuffer, width: Math.max(1, w0 >> l), height: Math.max(1, h0 >> l) })
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex: tex, levels: levels, forWidth: w, forHeight: h }
  }
  let deletePyramid = (p) => {
    system.gl.deleteTexture(p.tex)
    p.levels.forEach(l => system.gl.deleteFramebuffer(l.framebuffer))
  }
  let setFilter = (gl, base, max) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, base)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, max)
  }
  // Leaves the program, framebuffer, viewport, blend and texture unit 0 changed; sprite.js sets all
  // of them again before its own draw
  let buildPyramid = (src, p) => {
    let gl = system.gl
    let d = getDownShader()
    gl.useProgram(d.program)
    system.loadVertexAttrib(d.posBuf, d.posAttr, fullQuad, 2)
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(d.srcUnif, 0)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    setFilter(gl, 0, 0)
    let last = p.levels.length - 1
    p.levels.forEach((level, l) => {
      if (l > 0) {
        // Sampling one level while drawing into the next is only legal with the sampled range
        // clamped away from the attachment
        gl.bindTexture(gl.TEXTURE_2D, p.tex)
        setFilter(gl, l-1, l-1)
      }
      let above = p.levels[l-1]
      gl.uniform1i(d.exactUnif, l === 0 || (above.width === 2*level.width && above.height === 2*level.height) ? 1 : 0)
      gl.uniform2f(d.dstUnif, level.width, level.height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer)
      gl.viewport(0, 0, level.width, level.height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    })
    gl.bindTexture(gl.TEXTURE_2D, p.tex)
    setFilter(gl, 0, last)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  }
  let deleteTarget = (t) => {
    system.gl.deleteTexture(t.tex)
    system.gl.deleteFramebuffer(t.framebuffer)
    if (t.recordFramebuffer) { system.gl.deleteFramebuffer(t.recordFramebuffer) }
  }
  // pxrec: the px draws what is shown into fb.display and what is recorded into the target itself
  let recordFramebuffer = (t, display) => {
    let gl = system.gl
    if (t.recordFramebuffer && t.recordDisplay === display) { return t.recordFramebuffer }
    if (t.recordFramebuffer) { gl.deleteFramebuffer(t.recordFramebuffer) }
    t.recordFramebuffer = gl.createFramebuffer()
    t.recordDisplay = display
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.recordFramebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, display.tex, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t.tex, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return t.recordFramebuffer
  }

  // Kept on the player so the history survives new events and code edits
  let forPlayer = (player) => {
    let fb = (player && player.pxFeedback) || { rt: [], current: 0 }
    if (player) { player.pxFeedback = fb }
    if (!fb.read) {
      fb.read = { get tex() { let t = fb.rt[1 - fb.current]; return t && t.tex } }
      fb.pyramidRead = {
        get tex() { return fb.pyramid && fb.pyramid.tex },
        // sprite.js calls this after writing its own LINEAR filter
        params: () => { system.gl.texParameteri(system.gl.TEXTURE_2D, system.gl.TEXTURE_MIN_FILTER, system.gl.LINEAR_MIPMAP_LINEAR) },
      }
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
        if (fb.records && (!fb.display || fb.display.width !== w || fb.display.height !== h)) {
          if (fb.display) { deleteTarget(fb.display) }
          fb.display = createTarget(w, h)
        }
        if (fb.frame !== state.time) {
          fb.frame = state.time
          fb.current = 1 - fb.current
        }
        if (fb.mips && fb.pyramidFrame !== state.time) {
          fb.pyramidFrame = state.time
          if (fb.pyramid && (fb.pyramid.forWidth !== w || fb.pyramid.forHeight !== h)) { deletePyramid(fb.pyramid); fb.pyramid = undefined }
          if (!fb.pyramid) { fb.pyramid = createPyramid(w, h) }
          buildPyramid(fb.rt[1 - fb.current], fb.pyramid)
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
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.records ? recordFramebuffer(target, fb.display) : target.framebuffer)
        gl.viewport(0, 0, target.width, target.height)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        let c = getCopyShader()
        gl.useProgram(c.program)
        system.loadVertexAttrib(c.posBuf, c.posAttr, screenVtx, 2)
        system.loadVertexAttrib(c.fragCoordBuf, c.fragCoordAttr, frag, 2)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, fb.records ? fb.display.tex : target.tex)
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
    pyramidMarker: pyramidMarker,
    helper: helper,
    lodHelper: lodHelper,
    forPlayer: forPlayer,
    attach: attach,
  }
})
