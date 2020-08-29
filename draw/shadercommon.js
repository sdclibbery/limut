'use strict';
define(function (require) {

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 fragCoordIn;
  varying vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`

  let commonProcessors = `
    uniform vec2 scroll;
    uniform vec2 zoom;
    uniform float perspective;
    uniform float pixellate;
    uniform float additive;
    uniform vec4 fore;
    uniform vec4 back;
    uniform float brightness;
    vec2 preprocess( vec2 coord ) {
    if (perspective != 0.) {
      const float sz = 1.0;
      const float pz = 1.0;
      vec2 s = coord / sz;
      float p = (s.y*sin(perspective*0.68) + cos(perspective*0.68));
      vec2 uv = vec2(
        s.x*pz/p,
        s.y*pz/p
      );
      coord = uv;
    }
    coord = (coord + scroll) / zoom;
    if (pixellate != 0.) { coord = floor(coord*pixellate)/pixellate; }
    return coord;
  }
  void postprocess( vec4 col, float foreBack ) {
    col *= mix(back, fore, foreBack);
    gl_FragColor.rgb = col.rgb*brightness*mix(col.a, 1.0, additive);
    gl_FragColor.a = mix(col.a, 0.0, additive);
    if (length(gl_FragColor) < 0.01) discard;
  }
  `

  return {
    vtxShader: vtxShader,
    commonProcessors: commonProcessors,
  }
})