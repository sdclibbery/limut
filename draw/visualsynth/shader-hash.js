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

  // The classic sin hash: one dot product and one sin, then four different multipliers to get four
  // channels out of it. Cheaper than pcg4d (roughly 19 ops against 28, and no 32 bit integer
  // multiply, which is slow on some GPUs).
  //
  // The large constants are what make it work on *small* inputs: a px chain's value is normally in
  // -1 to 1, so the dot lands in the tens of radians and sin wraps many times across the quad —
  // which is exactly the domain the sin hash was designed for. Note that Hoskins' hash44 (the
  // obvious "hash without sine" choice) is NOT usable here: it mixes purely through fract(), and
  // multiplies its input by ~0.103 first, so on a -1 to 1 input it never wraps and the output comes
  // out smooth rather than random — visibly so, as arches rather than static. Scaling the input
  // does not save it either: the usable window is narrow and it collapses on either side (on a
  // value already scaled by 1000 it degenerated to 29 distinct colours across a 256x256 render).
  //
  // Two things this trades away against pcg4d, and the reason that one is the default:
  // sin precision varies between drivers and fract(sin(x)*43758) amplifies the difference, so the
  // pattern is not reproducible from GPU to GPU (it is still noise, just not the same noise); and
  // as with any float hash the distribution decays once the input or seed grows large.
  let sinHelper = {
    name: 'l_pxhashf',
    source: `vec4 l_pxhashf(vec4 p, vec4 s) {
  float a = sin(dot(p + s, vec4(12.9898, 78.233, 37.719, 4.581)));
  return fract(a * vec4(43758.5453, 22578.1459, 19642.3490, 32764.1234));
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
    sinHelper: sinHelper,
    hashSpec: hashSpec,
  }
})
