#version 300 es
// from https://www.shadertoy.com/view/XsS3Rm
precision mediump float;

in vec2 fragCoord;
uniform float iTime;
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

  vec2 ctr = vec2(-1.25, 0.06);
  float r = 0.03;
  float pi = 3.14159;
  float val = -l_value*pi*0.05;
  float rTime = 0.002;
	vec2 c = ctr+vec2(
    r*sin(val)+sin(iTime*pi/2.0)*rTime+cos(iTime*pi/5.0)*rTime + (l_amp-1.0)*0.02,
    r*cos(val)+cos(iTime*pi/2.0)*rTime+cos(iTime*pi/5.0)*rTime
  );
	vec2 v = uv;
	float scale = 0.01;

	int count = max_iterations;
	
	for ( int i = 0 ; i < max_iterations; i++ ) {
		v = c + complex_square( v );
		if ( dot( v, v ) > 4.0 ) {
			count = i;
			break;
		}
	}

  postprocess(vec4(1.0), float( count ) * scale);
}
