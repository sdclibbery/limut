precision highp float;
varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;
uniform vec4 spectrum;

void main() {
  vec2 uv = fragCoord;

	vec4 col = back;
	if (uv.x > -1.0 && uv.x < -0.5 && uv.y < spectrum.x*2.-1.) { col = vec4(1.,0.,0.,1.); }
	if (uv.x > -0.5 && uv.x < 0.0 && uv.y < spectrum.y*2.-1.) { col = vec4(1.,1.,0.,1.); }
	if (uv.x > 0.0 && uv.x < 0.5 && uv.y < spectrum.z*2.-1.) { col = vec4(0.,1.,0.,1.); }
	if (uv.x > 0.5 && uv.x < 1.0 && uv.y < spectrum.w*2.-1.) { col = vec4(0.,0.,1.,1.); }

  gl_FragColor = col*brightness*col.a;
	if (gl_FragColor.a < 0.01) discard;
}
