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
  uniform float iTime;
  uniform vec4 l_repeat;
  uniform vec2 l_scroll;
  uniform vec2 l_zoom;
  uniform float l_rotate;
  uniform vec4 l_mirror;
  uniform float l_perspective;
  uniform float l_tunnel;
  uniform vec4 l_ripple;
  uniform vec4 l_pixellate;
  uniform float l_additive;
  uniform vec4 l_fore;
  uniform vec4 l_mid;
  uniform vec4 l_back;
  uniform float l_monochrome;
  uniform float l_brightness;
  uniform float l_vignette;
  uniform float l_contrast;
  uniform int l_recol;
  vec2 origCoord;
  vec2 preprocess( vec2 coord ) {
    origCoord = coord;
    if (l_pixellate.x != 0.) {
      coord = floor((coord+(0.5/l_pixellate.xy))*l_pixellate.xy)/l_pixellate.xy;
    }
    if (l_ripple.x != 0.) {
      coord += coord*0.1*l_ripple.x*sin(length(coord)*24.0*l_ripple.y-iTime)/length(coord);
    }
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
    if (l_mirror.x != 0.) {
      float r = length(coord);
      float thetaBase = atan(coord.y, coord.x) - l_mirror.z*6.283;
      float n = l_mirror.x;
      bool flip = mod(floor(2.*n*thetaBase/6.283), 2.) < 1.0;
      float theta = fract(n*thetaBase/6.283)/n;
      if (!flip) { theta = 1./n - theta; }
      theta += (l_mirror.y/n)*floor(n*(thetaBase+3.142)/6.283);
      theta *= 6.283;
      theta += l_mirror.z*6.283;
      coord = vec2(cos(theta), -sin(theta))*r;
    }
    coord = coord / l_zoom;
    if (l_rotate != 0.) {
      float s = sin(l_rotate);
      float c = cos(l_rotate);
      mat2 rot = mat2(c, -s, s, c);
      coord = rot * coord;
    }
    coord = coord + l_scroll;
    if (l_repeat.x != 0.) {
      coord += l_repeat.x;
      coord = mod(coord, l_repeat.x*2.0);
      coord -= l_repeat.x;
      coord += l_repeat.zw;
    }
    return coord;
  }
  void postprocess( vec4 col, float foreBack ) {
    switch (l_recol) {
      case 1: { /* oil */
        float fb = foreBack+length(origCoord)/3.0;
        col = 0.5+0.5*vec4(sin(fb*17.0), sin(fb*18.5), sin(fb*20.0), 1.0);
        break;
      }
      case 2: { /* hue */
        float fb = foreBack*0.8+length(origCoord);
        col = 0.5+0.5*vec4(sin((fb+0.333)*6.2832), sin((fb+0.667)*6.2832), sin(fb*6.2832), 1.0);
        break;
      }
      case 3: { /* fire */
        float fb = (foreBack + 0.5 + 0.5*sin(origCoord.x))/2.0;
        float c = 0.5+0.5*sin(fb*3.0*6.2832)+0.25*(origCoord.y+1.0)*sin(origCoord.y*5.0-iTime*3.0);
        col = vec4(0.6+c, c, 0.0, 1.0);
        break;
      }
      case 4: { /* sunset */
        float fb = foreBack + 0.07*sin(origCoord.x*6.283);
        float c = min(max(fb,0.0),1.0);
        col = vec4(0.9-pow(c,1.2), 0.5-pow(c,0.8), 0.5-pow(c-0.6, 2.0), 1.0);
        break;
      }
      case 5: { /* neon */
        float c = min(max(foreBack,0.0),1.0) - mod(origCoord.x*origCoord.y,0.2)/5.0;
        float mag = min(max(pow(1.0-abs(c-0.75),10.0),0.0),1.0);
        float cya = min(max(pow(1.0-abs(c-0.25),10.0),0.0),1.0);
        col = vec4(mag, cya, mag+cya, 1.0);
        break;
      }
      case 6: { /* titanium */
        float fb = foreBack+origCoord.x/10.0;
        col = 0.5+0.4*vec4(-sin(fb*7.0), -sin(fb*9.0), -sin(fb*11.0), 1.0);
        break;
      }
      default: { /* original */
        break;
      }
    }
    if (l_vignette != 0.) {
      vec2 coord = origCoord;
      if (l_pixellate.x != 0.) { coord = mod((coord+(0.5/l_pixellate.xy))*l_pixellate.xy, 1.0)*2.0-1.0; }
      float p = 4.0/l_vignette;
      const float cutoff = 0.9;
      float d = pow(pow(abs(coord.x),p)+pow(abs(coord.y),p), 1.0/p);
      float vignette = d < cutoff ? 1.0 : max(1.0-(d-cutoff)/(1.0-cutoff),0.0);
      col.a *= vignette;
      col.rgb *= mix(1.0, vignette, l_additive);
    }
    if (l_tunnel != 0.) {
      float t = length(origCoord);
      col.rgb *= mix(1.,min(t,1.),l_tunnel);
    }
    if (l_monochrome != 0.) {
      vec3 mono = vec3(0.21*col.r + 0.71*col.g + 0.07*col.b);
      col.rgb = mix(col.rgb, mono, l_monochrome);
    }
    float b = min(foreBack > 0.5 ? 0.0 : 1.0-2.0*foreBack, 1.0);
    float m = max(foreBack < 0.5 ? 2.0*foreBack : 2.0*(1.0-foreBack), 0.0);
    float f = min(foreBack < 0.5 ? 0.0 : 2.0*foreBack-1.0, 1.0);
    col *= l_back*b + l_mid*m + l_fore*f;
    if (l_contrast != 0.) {
      col.rgb = pow(col.rgb,vec3(l_contrast+1.0));
    }
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
    shader.repeatUnif = system.gl.getUniformLocation(program, "l_repeat")
    shader.zoomUnif = system.gl.getUniformLocation(program, "l_zoom")
    shader.rotateUnif = system.gl.getUniformLocation(program, "l_rotate")
    shader.mirrorUnif = system.gl.getUniformLocation(program, "l_mirror")
    shader.pixellateUnif = system.gl.getUniformLocation(program, "l_pixellate")
    shader.tunnelUnif = system.gl.getUniformLocation(program, "l_tunnel")
    shader.rippleUnif = system.gl.getUniformLocation(program, "l_ripple")
    shader.perspectiveUnif = system.gl.getUniformLocation(program, "l_perspective")
    shader.additiveUnif = system.gl.getUniformLocation(program, "l_additive")
    shader.timeUnif = system.gl.getUniformLocation(program, "iTime")
    shader.brightnessUnif = system.gl.getUniformLocation(program, "l_brightness")
    shader.monochromeUnif = system.gl.getUniformLocation(program, "l_monochrome")
    shader.vignetteUnif = system.gl.getUniformLocation(program, "l_vignette")
    shader.recolUnif = system.gl.getUniformLocation(program, "l_recol")
    shader.valueUnif = system.gl.getUniformLocation(program, "l_value")
    shader.ampUnif = system.gl.getUniformLocation(program, "l_amp")
    shader.spectrumUnif = system.gl.getUniformLocation(program, "l_spectrum")
    shader.textureUnif = [system.gl.getUniformLocation(program, 'l_image')]
    shader.extentsUnif = system.gl.getUniformLocation(program, "l_extents")
    shader.eventTimeUnif = system.gl.getUniformLocation(program, "l_eventTime")
    shader.contrastUnif = system.gl.getUniformLocation(program, "l_contrast")
}

  return {
    vtxShader: vtxShader,
    commonProcessors: commonProcessors,
    getCommonUniforms: getCommonUniforms,
  }
})