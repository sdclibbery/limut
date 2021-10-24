#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

float hash( float p ) {
  return fract(sin(p)*43758.5453123);
}

void main() {
  vec2 uv = preprocess(fragCoord)*0.5;
  float r = 0.02; // Should be based on pixel resolution
  float width = 1.0/12.0;
  float pos = uv.x/width;
  float idx = floor(uv.x/width);
  float barpos = mod(pos, 1.0);
  float antialias = smoothstep(0.0,r,barpos)-smoothstep(1.0-r,1.0,barpos);

  float probAlternating = mod(idx, floor(5.0/pow(l_amp,0.25)));
  float probChaos = pow(hash(idx),0.5)*2.0;
  float prob = mix(probChaos, probAlternating, fract(l_value/10.0));
  float showbar = prob > l_amp ? 0.0 : 1.0;

  float bar = antialias*showbar;
  postprocess(vec4(1.0), bar);
}
