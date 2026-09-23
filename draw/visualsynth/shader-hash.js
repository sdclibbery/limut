'use strict'
define(function(require) {

  // GLSL hash functions for pxhash/pxhashf: a deterministic, well distributed random vec4 per
  // input value. No requires, so this is testable without a GL context (as codegen.js).

  // pcg4d, from Jarzynski & Olano, "Hash Functions for GPU Rendering" (JCGT 2020). Integer only, so
  // it is the same on every GPU and does not degrade for large inputs or seeds.
  // The seed is xored into the input bits rather than added, so it decorrelates the whole field
  // rather than translating it.
  // v must be highp: GLSL ES 3.00 defaults int to mediump (16 bits) in fragment shaders, and the
  // hash depends on 32 bit multiply wraparound.
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

  // The classic sin hash: about 1.8x faster than pcg4d, though both are cheap.
  // The large constants make it work on small inputs (px values are normally -1 to 1). Hoskins'
  // hash44 is NOT usable here: it scales its input down and mixes only through fract(), so on -1 to
  // 1 it never wraps and comes out smooth, and no input scaling fixes it reliably.
  // pcg4d is the default because this one varies between GPUs (driver sin precision, amplified by
  // the 43758 multiplier) and decays for large inputs or seeds.
  let sinHelper = {
    name: 'l_pxhashf',
    source: `vec4 l_pxhashf(vec4 p, vec4 s) {
  float a = sin(dot(p + s, vec4(12.9898, 78.233, 37.719, 4.581)));
  return fract(a * vec4(43758.5453, 22578.1459, 19642.3490, 32764.1234));
}`,
  }

  // Random rgb, keeping the incoming alpha, so mul{pxhash} cannot make a texture see through. Use
  // channels{a:pxhash} for a random alpha. An absent seed is the literal vec4(0.0), costing no
  // uniform; a given seed is an animated uniform.
  let hashSpec = (helper) => ({
    emit: (a, s) => `vec4(${helper.name}(${a}, ${s === undefined ? 'vec4(0.0)' : s}).rgb, (${a}).a)`,
    helpers: [helper],
  })

  return {
    pcg4dHelper: pcg4dHelper,
    sinHelper: sinHelper,
    hashSpec: hashSpec,
  }
})
