'use strict'
define(function(require) {

  // GLSL hash functions for the pxhash/pxhashf visual nodes: a well distributed pseudo random vec4
  // keyed on the incoming pixel value, so every pixel gets its own random number. Deterministic —
  // the same input and seed always give the same result — which is what makes it a hash rather
  // than a random generator, and what lets the shader stay a pure function of the pixel.
  //
  // Only the GLSL lives here (and the specs that wrap it, in shader-maths.js): no requires, so this
  // is testable without a GL context, the same discipline as codegen.js.

  // pcg4d, from Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020). Four
  // statistically independent output channels, and being integer only it gives the same answer on
  // every GPU and does not degrade as the input or seed grows large.
  //
  // The seed is xored into the input *bits* rather than added to the input, so it decorrelates the
  // whole field instead of just translating it. floatBitsToUint is an exact bitcast (and free), so
  // quantised coordinates (floor{1/8}) and large animated seeds both hash cleanly.
  //
  // v must be highp: GLSL ES 3.00 defaults int to mediump in fragment shaders, which is only
  // guaranteed 16 bits, and the whole hash depends on 32 bit multiply wraparound.
  let pcg4dHelper = {
    name: 'l_pxhash',
    source: `vec4 l_pxhash(vec4 p, vec4 s) {
  highp uvec4 v = floatBitsToUint(p) ^ floatBitsToUint(s);
  v = v*1664525u + 1013904223u;
  v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
  v ^= v >> 16u;
  v.x += v.y*v.w; v.y += v.z*v.x; v.z += v.x*v.y; v.w += v.y*v.z;
  return vec4(v) * (1.0/4294967296.0);
}`,
  }

  // hash44, from Dave Hoskins' "Hash without Sine". Cheaper — all float, so it avoids 32 bit
  // integer multiply, which is slow on some GPUs — but the four output channels are built from
  // overlapping swizzles and so are correlated, and being fract() of float products it loses
  // distribution as the input or seed magnitude grows. The seed can only be added here, which is
  // exactly why a large or long running animated seed degrades where pcg4d's does not.
  let hash44Helper = {
    name: 'l_pxhashf',
    source: `vec4 l_pxhashf(vec4 p, vec4 s) {
  vec4 p4 = fract((p + s) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`,
  }

  // Random rgb, with the incoming alpha kept, the same rule the dot node follows: px=pxhash is
  // opaque noise, and mul{pxhash} cannot silently make a texture see through. Use channels{a:pxhash}
  // where a random alpha is actually wanted.
  //
  // An absent seed becomes the literal vec4(0.0) rather than a uniform, so an unseeded hash is a
  // fixed field (and costs no uniform); a seed that is given registers its raw AST as a uniform in
  // the usual way, so it animates per frame.
  let hashSpec = (helper) => ({
    emit: (a, s) => `vec4(${helper.name}(${a}, ${s === undefined ? 'vec4(0.0)' : s}).rgb, (${a}).a)`,
    helpers: [helper],
  })

  return {
    pcg4dHelper: pcg4dHelper,
    hash44Helper: hash44Helper,
    hashSpec: hashSpec,
  }
})
