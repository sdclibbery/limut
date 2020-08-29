precision highp float;
varying vec2 fragCoord;
uniform vec4 l_spectrum;

#insert common-processors

float barHeight (float v) {
	return v*1.9 - 0.95;
}

void main() {
  vec2 uv = preprocess(fragCoord);

	float f = 0.0;
	if (uv.x > -0.95 && uv.x < -0.55 && uv.y < barHeight(l_spectrum.x)) { f = 1.0; }
	if (uv.x > -0.45 && uv.x < -0.05 && uv.y < barHeight(l_spectrum.y)) { f = 1.0; }
	if (uv.x > 0.05 && uv.x < 0.45 && uv.y < barHeight(l_spectrum.z)) { f = 1.0; }
	if (uv.x > 0.55 && uv.x < 0.95 && uv.y < barHeight(l_spectrum.w)) { f = 1.0; }
	vec4 col = vec4(vec3(1.)*f*(0.7+0.6*uv.y), 1.0);

    postprocess(col, f);
}
