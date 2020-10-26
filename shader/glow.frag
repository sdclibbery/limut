precision mediump float;

varying vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 pos = preprocess(fragCoord);

  float theta = iTime/6.0 + atan(pos.y, pos.x)/3.14159;
  float r = length(pos);

  float spike = abs(fract(theta*0.5*(6.0+mod(l_value,10.0)))-0.5)*2.0;
  spike = pow(spike, r*r*10.0)/(1.0+r*0.5);

  float glow = 0.2 / r * (l_amp/2.0 + 0.5);

  float f = pow(spike, 5.0) + pow(glow, 2.0);

  postprocess(vec4(f,f,f,0.), f);
}
