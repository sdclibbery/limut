#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord);
  vec2 uvt = vec2(uv.x+uv.y, -uv.x+uv.y)*0.707;
  ivec2 iuv = abs(ivec2(uvt*48.0));

  float v = l_value+20.0;
  float t = iTime/4.0;

  int i1 = ((iuv.x ^ iuv.y) + int(t)) % int(v);
  float f1 = 0.0;
  if (i1 == 0) f1 = 1.0;
  if (i1 == 1) f1 = l_amp/4.0;

  int i2 = ((iuv.x ^ iuv.y) + int(t+1.0)) % int(v);
  float f2 = 0.0;
  if (i2 == 0) f2 = 1.0;
  if (i2 == 1) f2 = l_amp/4.0;

  float f = mix(f1, f2, fract(t));

  postprocess(vec4(1.), f);
}
