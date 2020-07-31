// derived from https://www.shadertoy.com/view/4dlGDN
#extension GL_OES_standard_derivatives : enable
precision mediump float;
varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;

// Created by inigo quilez - iq/2013
// License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.

float hash( float n )
{
    return fract(sin(n)*43758.5453);
}

float noise( in vec2 x )
{
    vec2 p = floor(x);
    vec2 f = fract(x);
    f = f*f*(3.0-2.0*f);
    float n = p.x + p.y*57.0;
    return mix(mix( hash(n+  0.0), hash(n+  1.0),f.x),
               mix( hash(n+ 57.0), hash(n+ 58.0),f.x),f.y);
}

vec2 map( vec2 p, in float offset )
{
  p.x += 0.1*sin( iTime + 2.0*p.y ) ;
  p.y += 0.1*sin( iTime + 2.0*p.x ) ;

  float a = noise(p*1.5*(1.+value) + sin(0.1*iTime))*6.2831;
  a -= offset;
  return vec2( cos(a), sin(a) );
}

vec2 rotate(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  mat2 m = mat2(c, -s, s, c);
  return m * v;
}

void main()
{
  vec2 uv = fragCoord.xy*2.0;
  vec2 p = (uv+1.0)*0.5;

  float offset = iTime*2.0 + fragCoord.x;

  float acc = 0.0;
  vec4  col = vec4(0.0);
  for( int i=0; i<8; i++ )
  {
    vec2 dir = map( uv, offset );

    float h = float(i)/16.0;
    float w = 4.0*h*(1.0-h);

    vec3 ttt = vec3(rotate(uv, value),w);
    ttt *= mix( vec3(0.6,0.7,0.7), vec3(1.0,0.95,0.9), 0.5 - 0.5*dot( reflect(vec3(dir,0.0), vec3(1.0,0.0,0.0)).xy, vec2(0.707) ) );
    col += vec4(w*ttt,0.0);
    acc += w;

    uv += 0.008*dir;
  }
  col /= acc;

  float gg = dot( col, vec4(0.333) );
  vec3 nor = normalize( vec3( dFdx(gg), 0.5, dFdy(gg) ) );
  vec2 di = map( uv, offset )*1.5;
  col = clamp(mix(back, fore, amp*dot(nor,vec3(di,0.0))), 0.0, 1.0);

  gl_FragColor = col*brightness*col.a;
}
