precision mediump float;

varying vec2 fragCoord;
uniform float iTime;
uniform float l_eventTime;
uniform float l_value;
uniform float l_amp;

#insert common-processors

float seed = 0.32;
const float particles = 80.0;
    
void main() {
  vec2 pos = preprocess(fragCoord)*0.3;

	vec2 uv = pos*2.5;
  float f = 0.0;  
  float timecycle = l_eventTime;  
  seed = seed + l_value;
  
  float invparticles = 1.0/particles;
  for( float i=0.0; i<particles; i+=1.0 ) {
    seed += i+tan(seed);
    vec2 tPos = (vec2(cos(seed*(l_value*0.1+1.0)),sin(seed)))*i*invparticles;
    vec2 pPos = vec2(tPos.x * timecycle, tPos.y * timecycle);
      
    vec4 r1 = vec4(vec2(step(pPos,uv)), 1.0-vec2(step(pPos,uv)));
    float star = length(r1)/1000.0;
    float glow = smoothstep(0.0,200.0,(1.0/distance(uv, pPos+.015)))*l_amp;
    star = max(star,glow);
    f += star*(sin(iTime*10.0*(l_value+1.0)+i)+1.0);
  }
  f = pow(f, 2.0);

  postprocess(vec4(f,f,f,0.), f);
}
