// from https://www.shadertoy.com/view/Xd2Bzw
precision mediump float;

varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;

void main() {
  float av = abs(value);
  float t = iTime;
  float f = fract(t);
  vec2 p = fragCoord*0.5;
  p += p * sin(dot(p, p)*20.-t) * .04;
  vec4 c = vec4(0.);
  for (float i = 0.5 ; i < 8.0 ; i++) {
    p = abs(2.*fract(p-.5)-1.) * mat2(cos(.01*t*i*i + .78*vec4(1,7,3.+av,1)));
    vec4 dc = exp(-abs(p.y)*10.) * (cos(vec4(2,3.+value,1,0)*i)*.5+.5);
    c += fore*dc.a*0.3 + back*(1.0-dc.a)*0.3 + vec4(dc.rgb*0.4*amp, 0);
  }
  c.rgba *= .45;
  gl_FragColor = c * brightness * c.a;
}
