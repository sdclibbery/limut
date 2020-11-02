#version 300 es
#define varying in
#define gl_FragColor fragColor
precision mediump float;
out vec4 fragColor;

varying vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord)*0.5;

  ivec2 i = ivec2(uv+60.*iTime);
  float f = float(i.x ^ i.y);

  postprocess(vec4(1.), pow(f, 10.0/l_amp));
}
