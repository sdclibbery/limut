#version 300 es
// from https://www.shadertoy.com/view/XsS3Rm
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

const int max_iterations = 255;

vec2 complex_square( vec2 v ) {
  return vec2(
    v.x * v.x - v.y * v.y,
    v.x * v.y * 2.0
  );
}

void main() {
  vec2 uv = preprocess(fragCoord).xy/2.5;

  vec2 ctr;
  float scale;
  float brightness = 1.0;
  int type = abs(int(l_value))%8;
  if (type == 0) { ctr = vec2(-0.643, 0.395); scale=2.4; } // swirly
  if (type == 1) { ctr = vec2(-0.747, 0.138); scale=2.4; } // swirly bulbous
  if (type == 2) { ctr = vec2(0.28, 0.008); scale=3.0; } // blob swirl
  if (type == 3) { ctr = vec2(-0.79, 0.15); scale=2.4; } // swirly
  if (type == 4) { ctr = vec2(-1.108, 0.236); scale=2.0; } // swirly fibre
  if (type == 5) { ctr = vec2(-0.162, 1.04); scale=0.3; } // fibrous
  if (type == 6) { ctr = vec2(-1.476, 0.0); scale=0.6; brightness=3.0; } // stars
  if (type == 7) { ctr = vec2(-1.016, 0.409); scale=2.4; brightness=12.0; } // dust

  float pi = 3.14159;
  float rTime = 0.0003 * (1.0 + l_value/8.0);
  vec2 c = ctr+vec2(
    sin(iTime*pi/2.0)*rTime+cos(iTime*pi/5.0)*rTime,
    cos(iTime*pi/2.0)*rTime+cos(iTime*pi/5.0)*rTime
  );
  vec2 v = uv*scale;

  int count = max_iterations;

  for ( int i = 0 ; i < max_iterations; i++ ) {
    v = c + complex_square( v );
    if ( dot( v, v ) > 4.0 ) {
      count = i;
      break;
    }
  }

  postprocess(vec4(1.0), brightness * float(count) / float(max_iterations));
}
