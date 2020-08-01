precision mediump float;
varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;

vec2 rotate(vec2 v, float a) {
	float s = sin(a);
	float c = cos(a);
	mat2 m = mat2(c, -s, s, c);
	return m * v;
}

void main()
{
    vec2 uv = fragCoord;//-0.5;
    uv = rotate(uv, sin(iTime*0.67)*0.7*clamp(value/20.,0.,1.));

    float f = 1000000000.0;
    float lineAmp = clamp(amp, 0.0, 2.0);

    f = min(f, abs(uv.y + 0.2*lineAmp*sin(uv.x*7.0*(1.2+sin(iTime)))) - 0.005*amp);

    uv.x += 0.1;
    f = min(f, abs(uv.y + 0.2*lineAmp*sin(uv.x*(7.0+value/11.0)*(1.2+sin(iTime+0.3)))) - 0.007*amp);

    uv.y += 0.1;
    f = min(f, abs(uv.y + 0.2*lineAmp*sin(uv.x*(7.0+value/7.0)*(1.2+sin(iTime+0.5)))) - 0.011*amp);

    vec4 col = mix(fore, back, pow(clamp(f,0.,1.), 0.1));
    gl_FragColor = col*brightness*col.a;
		if (gl_FragColor.a < 0.01) discard;
}
