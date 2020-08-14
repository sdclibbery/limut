precision highp float;
varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;
uniform vec4 spectrum;

#insert common-processors

float barHeight (float v) {
	return v*1.9 - 0.95;
}

void main() {
  vec2 uv = preprocess(fragCoord);

	vec4 col = back;
	if (uv.x > -0.95 && uv.x < -0.55 && uv.y < barHeight(spectrum.x)) { col = vec4(fore.rgb*(0.7+0.6*uv.y), fore.a); }
	if (uv.x > -0.45 && uv.x < -0.05 && uv.y < barHeight(spectrum.y)) { col = vec4(fore.rgb*(0.7+0.6*uv.y), fore.a); }
	if (uv.x > 0.05 && uv.x < 0.45 && uv.y < barHeight(spectrum.z)) { col = vec4(fore.rgb*(0.7+0.6*uv.y), fore.a); }
	if (uv.x > 0.55 && uv.x < 0.95 && uv.y < barHeight(spectrum.w)) { col = vec4(fore.rgb*(0.7+0.6*uv.y), fore.a); }

  gl_FragColor = postprocess(col*brightness*col.a);
	if (gl_FragColor.a < 0.01) discard;
}
