'use strict'
define(function(require) {
  // GLSL ports of draw/colour.js's colour space conversions, for a colour whose components are
  // chain values (px=set{{h:id.u}}) and so cannot be converted on the CPU into a uniform.
  //
  // No requires at all, the same discipline as shader-hash.js: shader-node.js assembles these into
  // nodes, so the require graph stays acyclic. Helper names are fixed literals rather than ctx
  // counters, which is safe because addFunction dedupes by name and the l_ prefix keeps them clear
  // of the generated vN/u_vsN names — and it keeps the generated source deterministic.
  //
  // These must agree with draw/colour.js: a colour reaching a uniform and one reaching the shader
  // can never be allowed to disagree about what it means.

  // hsv2rgb: k is mod'ed rather than left as JS's truncated remainder, matching the floor mod
  // draw/colour.js now uses, so a negative hue wraps rather than washing out to white.
  let hsv2rgbHelper = {
    name: 'l_hsv2rgb',
    source: `vec3 l_hsv2rgb(float h, float s, float v) {
  vec3 k = mod(vec3(5.0, 3.0, 1.0) + h*6.0, 6.0);
  return v - v*s*clamp(min(k, 4.0-k), 0.0, 1.0);
}`,
  }

  // lab2rgb: LabLCH to sRGB, including draw/colour.js's 0.1 hue offset. Both of its conditionals
  // become mix/step, and the gamma branch takes pow of max(rgb,0) because GLSL evaluates both sides
  // — the CPU only ever calls Math.pow on the positive one, where pow of a negative is NaN.
  let lab2rgbHelper = {
    name: 'l_lab2rgb',
    source: `vec3 l_lab2rgb(float l, float c, float labh) {
  float h = labh + 0.1;
  float la = c * cos(h * 6.283185307179586);
  float lb = c * sin(h * 6.283185307179586);
  float y = (l*100.0 + 16.0)/116.0;
  vec3 f = vec3(la/5.0 + y, y, y - lb/2.0);
  vec3 t = f*f*f;
  vec3 xyz = mix((f - 16.0/116.0)/7.787, t, step(vec3(0.008856), t)) * vec3(0.95047, 1.0, 1.08883);
  vec3 rgb = vec3(dot(xyz, vec3(3.2406, -1.5372, -0.4986)), dot(xyz, vec3(-0.9689, 1.8758, 0.0415)), dot(xyz, vec3(0.0557, -0.2040, 1.0570)));
  return mix(12.92*rgb, 1.055*pow(max(rgb, 0.0), vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), rgb));
}`,
  }

  // The components of a colour written in a space that needs converting. Scalars, not channels: an
  // s is saturation here rather than the x channel, which is why isConvertedColour (shader-node.js)
  // has to answer before the channel table is consulted.
  let scalarColourKeys = ['labh', 'l', 'c', 'h', 's', 'v']

  return {
    hsv2rgbHelper: hsv2rgbHelper,
    lab2rgbHelper: lab2rgbHelper,
    scalarColourKeys: scalarColourKeys,
  }
})
