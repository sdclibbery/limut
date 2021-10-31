#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

vec2 hash( vec2 p ) {
  p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

void main() {
  vec2 pos = preprocess(fragCoord);

  float count = (l_value+3.0);
  vec2 h = hash(floor(pos*count));

  pos = (mod(pos*count, 1.0) - 0.5)*(1.0+mod(length(h),5.0)*0.3) + h/2.0;

  float theta = iTime*length(h)/18.0 + atan(pos.y, pos.x)/3.14159 + length(h);
  float r = length(pos);

  float spike = abs(fract(theta*0.5*(6.0+mod(length(h)+l_value,10.0)))-0.5)*1.0;
  spike = pow(spike, r*r*(5.0+5.0*length(h)))/(1.0+r*0.5);

  float glow = 0.03 / r * (l_amp/10.0*length(h) + 0.5);

  float f = pow(spike, 10.0) + pow(glow, 1.5);

  postprocess(vec4(f,f,f,0.), f);
}
