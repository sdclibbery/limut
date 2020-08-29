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
    uniform vec2 l_scroll;
    uniform vec2 l_zoom;
    uniform float l_perspective;
    uniform float l_pixellate;
    uniform float l_additive;
    uniform vec4 l_fore;
    uniform vec4 l_back;
    uniform float l_brightness;
    vec2 preprocess( vec2 coord ) {
    if (l_perspective != 0.) {
      const float sz = 1.0;
      const float pz = 1.0;
      vec2 s = coord / sz;
      float p = (s.y*sin(l_perspective*0.68) + cos(l_perspective*0.68));
      vec2 uv = vec2(
        s.x*pz/p,
        s.y*pz/p
      );
      coord = uv;
    }
    coord = (coord + l_scroll) / l_zoom;
    if (l_pixellate != 0.) { coord = floor(coord*l_pixellate)/l_pixellate; }
    return coord;
  }
  void postprocess( vec4 col, float foreBack ) {
    col *= mix(l_back, l_fore, foreBack);
    gl_FragColor.rgb = col.rgb*l_brightness*mix(col.a, 1.0, l_additive);
    gl_FragColor.a = mix(col.a, 0.0, l_additive);
    if (length(gl_FragColor) < 0.01) discard;
  }
  `

  return {
    vtxShader: vtxShader,
    commonProcessors: commonProcessors,
  }
})