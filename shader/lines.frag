#version 300 es
// from https://www.shadertoy.com/view/wd3SDH
precision mediump float;
in vec2 fragCoord;
uniform float iTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main()
{
  vec2 uv = 0.5-preprocess(fragCoord)*0.4;

  float time=iTime*20.0;
 	float ot1=5.0;
  float ot3=2.0;
  float ot5=0.1;
  float ot7=0.01;
  float ot9=0.025;
 	float Q=5000.;
  float amnt;
	float nd;
	float ip;
	float alpha;
	vec4 cbuff = vec4(0.0);
	float f = 0.0;
	float sinAmp = sqrt(l_amp)*1.3;

	for(float i=0.0; i<10.0;i++){
		ip=i-2.0;
	  nd = sinAmp/4.0*ot1*sin(uv.x*2.0*3.14+ip*0.4+time*0.05)/2.0;
	  nd += sinAmp/4.0*ot3*sin(3.0*uv.x*2.0*3.14+ip*0.4)/2.0;
	  nd += sinAmp/4.0*ot5*sin(5.0*uv.x*2.0*3.14+ip*0.4)/2.0;
	  nd += sinAmp/4.0*ot7*sin(7.0*uv.x*2.0*3.14+ip*0.4)/2.0;
	  nd/=5.0;
	  nd+=0.5;
	  amnt = 1.0/abs(nd-uv.y)*0.01;
    amnt = smoothstep(0.1, 0.5+uv.y*10.0/(1.+abs(l_value)), amnt)*5.5;
	  alpha=(10.0-i)/5.0;
	  f += amnt*alpha/5.0;
	  cbuff += vec4(amnt*alpha*0.3, amnt*0.3*alpha , amnt*uv.y*alpha,0) ;
	}

  postprocess(vec4(cbuff.rgb, 1.0), f);
}
