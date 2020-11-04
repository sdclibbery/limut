#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord)*l_amp;
  ivec2 iuv = abs(ivec2(uv*256.0));

  int type = abs(int(l_value))%3;
  int i;
  if (type == 0) i = iuv.x | iuv.y;
  if (type == 1) i = iuv.x & iuv.y;
  if (type == 2) i = iuv.x ^ iuv.y;
  i = int(pow(float(i), 1.0+l_value/100.0));

  float f = fract((float(i)-iTime*256.0) / 256.0);
  f = pow(f, 1.0/l_amp);

  postprocess(vec4(1.), f);
}
