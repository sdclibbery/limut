'use strict'
define(function(require) {

  // GLSL for the vhs visual nodes (nodes.js): the vhs standard visual param (draw/shadercommon.js,
  // itself from https://www.shadertoy.com/view/XtBXDt) split into the helpers a px chain calls.
  // Only the GLSL lives here, with no requires, so it is testable without a GL context, the same
  // discipline as shader-hash.js. Helper names are fixed l_ literals, deduped by ctx.addFunction.
  //
  // Two departures from the param's shader, neither visible: pow(sin(x), 2.0) is s*s, since GLSL
  // leaves pow undefined for a negative base; and the switching noise terms of the colour stage are
  // gone, since the param's preprocess declares a local snPhase that shadows the global, so its
  // postprocess only ever sees zero there.

  let randHelper = {
    name: 'l_vhsrand',
    source: `float l_vhsrand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}`,
  }

  // The tape warp of a coordinate, in 0 to 1 space: the warped uv in xy, the crease phase in z, and
  // in w whether the warp ran off the edge of the tape. Both stages need it, so it is its own helper
  // and vhs{} computes it once for both.
  let warpHelper = {
    name: 'l_vhswarp',
    source: `vec4 l_vhswarp(vec2 coord, float t) {
  vec2 uv = 0.5 + coord*0.5;
  float tcPhase = clamp((sin(uv.y*8.0 - t*3.14*0.6) - 0.92)*l_vhsrand(vec2(t*0.5)), 0.0, 0.01)*10.0;
  float tcNoise = max(l_vhsrand(vec2(uv.y*100.0, t*10.0)) - 0.5, 0.0)*1.5;
  uv.x -= tcNoise*tcPhase;
  uv.x += (l_vhsrand(vec2(uv.y, t)) - 0.5)*0.005;
  uv.x += (l_vhsrand(vec2(uv.y*100.0, t*10.0)) - 0.5)*0.01;
  float snPhase = smoothstep(0.04, 0.0, uv.y);
  uv.y += snPhase*0.3;
  uv.x += snPhase*((l_vhsrand(vec2(uv.y*100.0, t*10.0)) - 0.5)*0.2);
  float outside = (uv.x - tcNoise*tcPhase*1.5 < -0.2 || uv.x > 1.2) ? 1.0 : 0.0;
  return vec4(uv, tcPhase, outside);
}`,
  }

  // The coordinate stage: the incoming xy moved to the warp, mixed in by amt; z and w pass through
  let uvHelper = {
    name: 'l_vhsuv',
    source: `vec4 l_vhsuv(vec4 p, vec4 w, float amt) {
  return vec4(mix(p.xy, w.xy*2.0 - 1.0, amt), p.zw);
}`,
  }

  // The colour stage: col is the colour, w the warp and coord the coordinate it was warped from.
  // amt of zero leaves col exactly alone, as a zero vhs param skips the effect entirely.
  let rgbHelper = {
    name: 'l_vhsrgb',
    source: `vec4 l_vhsrgb(vec4 col, vec4 w, vec2 coord, float amt, float t) {
  vec2 uv = 0.5 + coord*0.5;
  vec3 res = col.rgb;
  res = mix(res, fwidth(res), 0.2);
  res *= 1.0 - w.z;
  res *= 1.0 - w.w;
  res *= 1.0 + clamp(l_vhsrand(vec2(0.0, uv.y + t*0.2))*0.6 - 0.25, 0.0, 0.1);
  vec4 c = clamp(col, 0.0, 1.0);
  res = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * res;
  res = vec3(0.1, -0.1, 0.0) + vec3(0.9, 1.1, 1.5)*res;
  float scan = sin(uv.y*6.28*120.0);
  res.x *= scan*scan*1.2;
  res.yz += sin(uv.y*vec2(3.21, 5.33) + t*vec2(-0.79, 0.83))*0.03;
  res = mat3(1.000, 1.000, 1.000, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * res;
  return amt == 0.0 ? col : vec4(mix(c.rgb, res, amt), c.a);
}`,
  }

  return {
    warpHelpers: [randHelper, warpHelper],
    uvHelper: uvHelper,
    rgbHelper: rgbHelper,
  }
})
