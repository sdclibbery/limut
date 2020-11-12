'use strict';
define(function (require) {
  let system = require('draw/system')

  let vtxShader = `#version 300 es
  in vec2 posIn;
  in vec2 fragCoordIn;
  out vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`

  let commonProcessors = `
    out vec4 fragColor;
    uniform vec2 l_scroll;
    uniform vec2 l_zoom;
    uniform float l_rotate;
    uniform float l_perspective;
    uniform float l_tunnel;
    uniform float l_pixellate;
    uniform float l_additive;
    uniform vec4 l_fore;
    uniform vec4 l_mid;
    uniform vec4 l_back;
    uniform float l_monochrome;
    uniform float l_brightness;
    vec2 origCoord;
    vec2 preprocess( vec2 coord ) {
    origCoord = coord;
    if (l_perspective != 0.) {
      const float sz = 1.0;
      const float pz = 1.0;
      vec2 s = coord / sz;
      float p = (origCoord.y*sin(l_perspective*0.68) + cos(l_perspective*0.68));
      vec2 uv = vec2(
        s.x*pz/p,
        s.y*pz/p
      );
      coord = uv;
    }
    if (l_tunnel != 0.) {
      float r = 2.0/(length(coord)*2.0 + 1.0) - 1.0;
      float theta = atan(coord.x, coord.y)/6.28;
      coord = mix(coord, vec2(r*0.5, theta), l_tunnel);
    }
    coord = coord / l_zoom;
    if (l_rotate != 0.) {
      float s = sin(l_rotate);
      float c = cos(l_rotate);
      mat2 rot = mat2(c, -s, s, c);
      coord = rot * coord;
    }
    coord = coord + l_scroll;
    if (l_pixellate != 0.) { coord = floor((coord+(0.5/l_pixellate))*l_pixellate)/l_pixellate; }
    return coord;
  }
  void postprocess( vec4 col, float foreBack ) {
    if (l_tunnel != 0.) {
      float t = length(origCoord);
      col.rgb *= mix(1.,min(t,1.),l_tunnel);
    }
    vec3 mono = vec3(0.21*col.r + 0.71*col.g + 0.07*col.b);
    col.rgb = mix(col.rgb, mono, l_monochrome);
    float b = min(foreBack > 0.5 ? 0.0 : 1.0-2.0*foreBack, 1.0);
    float m = max(foreBack < 0.5 ? 2.0*foreBack : 2.0*(1.0-foreBack), 0.0);
    float f = min(foreBack < 0.5 ? 0.0 : 2.0*foreBack-1.0, 1.0);
    col *= l_back*b + l_mid*m + l_fore*f;
    fragColor.rgb = col.rgb*l_brightness*mix(col.a, 1.0, l_additive);
    fragColor.a = mix(col.a, 0.0, l_additive);
    if (length(fragColor) < 0.01) discard;
  }
  `

  let getCommonUniforms = (shader) => {
    let program = shader.program
    shader.posBuf = system.gl.createBuffer()
    shader.posAttr = system.gl.getAttribLocation(program, "posIn")
    shader.fragCoordBuf = system.gl.createBuffer()
    shader.fragCoordAttr = system.gl.getAttribLocation(program, "fragCoordIn")
    shader.foreUnif = system.gl.getUniformLocation(program, "l_fore")
    shader.midUnif = system.gl.getUniformLocation(program, "l_mid")
    shader.backUnif = system.gl.getUniformLocation(program, "l_back")
    shader.scrollUnif = system.gl.getUniformLocation(program, "l_scroll")
    shader.zoomUnif = system.gl.getUniformLocation(program, "l_zoom")
    shader.rotateUnif = system.gl.getUniformLocation(program, "l_rotate")
    shader.pixellateUnif = system.gl.getUniformLocation(program, "l_pixellate")
    shader.tunnelUnif = system.gl.getUniformLocation(program, "l_tunnel")
    shader.perspectiveUnif = system.gl.getUniformLocation(program, "l_perspective")
    shader.additiveUnif = system.gl.getUniformLocation(program, "l_additive")
    shader.timeUnif = system.gl.getUniformLocation(program, "iTime")
    shader.brightnessUnif = system.gl.getUniformLocation(program, "l_brightness")
    shader.monochromeUnif = system.gl.getUniformLocation(program, "l_monochrome")
    shader.valueUnif = system.gl.getUniformLocation(program, "l_value")
    shader.ampUnif = system.gl.getUniformLocation(program, "l_amp")
    shader.spectrumUnif = system.gl.getUniformLocation(program, "l_spectrum")
    shader.textureUnif = [system.gl.getUniformLocation(program, 'l_image')]
    shader.extentsUnif = system.gl.getUniformLocation(program, "l_extents")
    shader.eventTimeUnif = system.gl.getUniformLocation(program, "l_eventTime")
}

  return {
    vtxShader: vtxShader,
    commonProcessors: commonProcessors,
    getCommonUniforms: getCommonUniforms,
  }
})