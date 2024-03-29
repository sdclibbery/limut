#version 300 es
precision highp float;
in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

// From https://www.shadertoy.com/view/4lGSzV
float drawFloat(in vec2 charCoord, float value, float digits, float decimals) {
  charCoord *= 4.0;
	float bits = 0.;
	float sgn = sign(value);
	if(charCoord.y < 0. || charCoord.y >= 1.5 || charCoord.x < step(-value,0.)) return bits; // early out above and below
	float digitIndex = digits - floor(charCoord.x)+ 1.;
	if(- digitIndex <= decimals) { // restrict to required precision
		float pow1 = pow(10., digitIndex);
		float absValue = abs(value);
		float pivot = max(absValue, 1.5) * 10.;
		if(pivot < pow1) bits = 1792.*float(value < 0. && pivot >= pow1 * .1); // cutoff leading zeroes and return minus sign
		else if(digitIndex == 0.) bits = 2.*float(decimals > 0.); // decimal point
		else { // calculate digit to show at location
			value = digitIndex < 0. ? fract(absValue) : absValue * 10.;
			int x = int(mod(value, pow1*10.)/pow1);
			bits = x==0?480599.:x==1?139810.:x==2?476951.:x==3?476999.:x==4?350020.:x==5?464711.:x==6?464727.:x==7?476228.:x==8?481111.:x==9?481095.:0.;
		}
	}
	bits=bits+0.1; // Fix some rounding thing causing pixels to be wrong
	return floor(mod(bits / pow(2., floor(fract(charCoord.x) * 4.) + floor(charCoord.y * 4.) * 4.), 2.));
}

void main() {
  vec2 uv = preprocess(fragCoord)*0.75;
  float f = drawFloat(uv+vec2(5.2,0.1), l_value, 20., 2.);
  vec4 col = vec4(f,f,f,1);
  postprocess(col, f);
}
