#version 300 es
// from https://www.shadertoy.com/view/Xd2Bzw
precision mediump float;

in vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  float av = abs(l_value);
  float t = iTime/2.;
  float f = fract(t);
  vec2 p = preprocess(fragCoord)*0.25;
  //p += p * sin(dot(p, p)*20.-t) * .04;
  vec4 c = vec4(0.);
  vec4 dc;
  for (float i = 0.5 ; i < 8.0 ; i++) {
    p = abs(2.*fract(p-.5)-1.) * mat2(cos(.01*t*i*i + .78*vec4(1.,7.,3.+av,1.)));
    c += exp(-abs(p.y)*5./(0.4 + 0.6*l_amp)) * (cos(vec4(2,3,1,0)*i)*.5+.5);
  }
  c.rgba *= .4;
  postprocess(c, c.a);
}
