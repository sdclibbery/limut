precision mediump float;

varying vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 pos = preprocess(fragCoord)*0.3;

	vec2 A = sin(vec2(0, 1.57)+iTime/4.);
  vec2 U = abs( pos * mat2(A, -A.y, A.x) ) * mat2(2.0,0.0,1.0,1.7); 
  float f = 0.1*l_amp/max(U.x,U.y);
  f += pow((1.0-length(pos))*l_value*0.1, 5.0);
  f = pow(f, 1.0+2.0*length(pos));

  postprocess(vec4(f,f,f,0.), f);
}
