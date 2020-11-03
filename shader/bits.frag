#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord)*l_amp;
  ivec2 iuv = ivec2(uv*256.0);

  int type = abs(int(l_value))%3;
  int power = abs(int(l_value/3.0))%3;
  int skew = int(l_value*uv.x);
  int i;
  if (type == 0) i = iuv.x & iuv.y + skew;
  if (type == 1) i = iuv.x | iuv.y + skew;
  if (type == 2) i = iuv.x ^ iuv.y + skew;
  if (power == 0) i = i;
  if (power == 1) i = i*i;
  if (power == 2) i = i*i;

  float f = fract((float(i)+iTime*60.0) / 256.0);
  postprocess(vec4(1.), f);
}
