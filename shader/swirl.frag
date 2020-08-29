// derived from https://www.shadertoy.com/view/MdXGDH
precision highp float;
varying vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

float hash( vec2 p ) {
	  float h = dot(p,vec2(127.1,311.7));
    return -1.0 + 2.0*fract(sin(h)*43758.5453123);
}

float noise( in vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
	  vec2 u = f*f*(3.0-2.0*f);
    return mix( mix( hash( i + vec2(0.0,0.0) ),
                     hash( i + vec2(1.0,0.0) ), u.x),
                mix( hash( i + vec2(0.0,1.0) ),
                     hash( i + vec2(1.0,1.0) ), u.x), u.y);
}

const mat2 m = mat2( 0.80,  0.60, -0.60,  0.80 );
float fbm( vec2 p ) {
    float f = 0.0;
    f += 0.5000*noise( p ); p = m*p*2.02;
    f += 0.2500*noise( p ); p = m*p*2.03;
    f += 0.1250*noise( p ); p = m*p*2.01;
    f += 0.0625*noise( p );
    return f/0.9375;
}

vec2 fbm2( in vec2 p ) {
    return vec2( fbm(p.xy), fbm(p.yx) );
}

const float PI = 3.14159265;
void main() {
  vec2 uv = preprocess(fragCoord)/2.0;

  vec2 n = fbm2(uv + fbm2(uv.yx+vec2(0, iTime*0.2)));
  uv += (l_amp+0.2)*8.0*n;
  float f = abs(sin(uv.x)*sin(uv.y));
  f = pow(1.-f, (l_value > 10.0) ? l_value/10.0 : (l_value+2.)/5.);
  vec4 col = vec4(abs(n)*1.3, f, 1.0);
  postprocess(col, f);
}
