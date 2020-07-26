'use strict';
define(function (require) {
  let system = require('draw/system')
  let param = require('player/default-param')

  let vtxShader = `//
  attribute vec2 posIn;
  attribute vec2 fragCoordIn;
  varying vec2 fragCoord;
  void main() {
    gl_Position = vec4(posIn, 0, 1);
    fragCoord = fragCoordIn;
  }`

  let frgShader = `// from https://www.shadertoy.com/view/4tdSWr
  precision mediump float;
  varying vec2 fragCoord;
  uniform float iTime;
  uniform float eventTime;
  uniform float value;
  uniform float amp;

  const vec2 iResolution = vec2(1,1);
  const float cloudscale = 1.1;
  const float speed = 0.03;
  const float clouddark = 0.5;
  const float cloudlight = 0.3;
  const float cloudcover = 0.2;
  const float cloudalpha = 8.0;
  const float skytint = 0.5;

  const mat2 m = mat2( 1.6,  1.2, -1.2,  1.6 );

  vec2 hash( vec2 p ) {
  	p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
  	return -1.0 + 2.0*fract(sin(p)*43758.5453123);
  }

  float noise( in vec2 p ) {
      const float K1 = 0.366025404; // (sqrt(3)-1)/2;
      const float K2 = 0.211324865; // (3-sqrt(3))/6;
  	vec2 i = floor(p + (p.x+p.y)*K1);
      vec2 a = p - i + (i.x+i.y)*K2;
      vec2 o = (a.x>a.y) ? vec2(1.0,0.0) : vec2(0.0,1.0); //vec2 of = 0.5 + 0.5*vec2(sign(a.x-a.y), sign(a.y-a.x));
      vec2 b = a - o + K2;
  	vec2 c = a - 1.0 + 2.0*K2;
      vec3 h = max(0.5-vec3(dot(a,a), dot(b,b), dot(c,c) ), 0.0 );
  	vec3 n = h*h*h*h*vec3( dot(a,hash(i+0.0)), dot(b,hash(i+o)), dot(c,hash(i+1.0)));
      return dot(n, vec3(70.0));
  }

  float fbm(vec2 n) {
  	float total = 0.0, amplitude = 0.1;
  	for (int i = 0; i < 7; i++) {
  		total += noise(n) * amplitude;
  		n = m * n;
  		amplitude *= 0.4;
  	}
  	return total;
  }

  vec3 hsl2rgb( float h, float s, float l )
  {
      vec3 rgb = clamp( abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0 );
      return l + s * (rgb-0.5)*(1.0-abs(2.0*l-1.0));
  }

  // -----------------------------------------------

  void main () {
      vec2 p = fragCoord.xy / iResolution.xy;
  	vec2 uv = p*vec2(iResolution.x/iResolution.y,1.0);
      float time = iTime * speed;
      float q = fbm(uv * cloudscale * 0.5);

      //ridged noise shape
  	float r = 0.0;
  	uv *= cloudscale;
      uv -= q - time;
      float weight = 0.8;
      for (int i=0; i<8; i++){
  		r += abs(weight*noise( uv ));
          uv = m*uv + time;
  		weight *= 0.7;
      }

      //noise shape
  	float f = 0.0;
      uv = p*vec2(iResolution.x/iResolution.y,1.0);
  	uv *= cloudscale;
      uv -= q - time;
      weight = 0.7;
      for (int i=0; i<8; i++){
  		f += weight*noise( uv );
          uv = m*uv + time;
  		weight *= 0.6;
      }

      f *= r + f;

      //noise colour
      float c = 0.0;
      time = iTime * speed * 2.0;
      uv = p*vec2(iResolution.x/iResolution.y,1.0);
  	  uv *= cloudscale*2.0;
      uv -= q - time;
      weight = 0.4;
      for (int i=0; i<7; i++){
  		c += weight*noise( uv );
          uv = m*uv + time;
  		weight *= 0.6;
      }

      //noise ridge colour
      float c1 = 0.0;
      time = iTime * speed * 3.0;
      uv = p*vec2(iResolution.x/iResolution.y,1.0);
  	  uv *= cloudscale*3.0;
      uv -= q - time;
      weight = 0.4;
      for (int i=0; i<7; i++){
  		c1 += abs(weight*noise( uv ));
          uv = m*uv + time;
  		weight *= 0.6;
      }

      c += c1;

      vec3 skycolour1 = hsl2rgb(0.65+value*0.1, 0.5, 0.55*amp);
      vec3 skycolour2 = hsl2rgb(0.65+value*0.1, 0.45, 0.65*amp);
      vec3 skycolour = mix(skycolour2, skycolour1, p.y);
      vec3 cloudcolour = vec3(1.1, 1.1, 0.9) * clamp((clouddark + cloudlight*c), 0.0, 1.0);

      f = cloudcover + cloudalpha*f*r;

      vec3 result = mix(skycolour, clamp(skytint * skycolour + cloudcolour, 0.0, 1.0), clamp(f + c, 0.0, 1.0));

  	gl_FragColor = vec4( result, 1.0 );
  }`

  let program
  let posBuf
  let posAttr
  let fragCoordBuf
  let fragCoordAttr
  let timeUnif
  let eventTimeUnif
  let valueUnif
  let ampUnif
  return (params) => {
    let amp = param(params.amp, 1)
    if (amp < 0.001) { return }
    let startTime = params.time
    let endTime = params.time + param(params.sus, param(params.dur, 1)) * params.beat.duration
    let value = parseInt(param(params.value, '0'))
    let rate = param(params.rate, 1)
    if (Number.isNaN(value)) { value = param(params.value, '0').charCodeAt(0) - 32 }
    if (!program) {
      program = system.loadProgram([
        system.loadShader(vtxShader, system.gl.VERTEX_SHADER),
        system.loadShader(frgShader, system.gl.FRAGMENT_SHADER)
      ])
      posBuf = system.gl.createBuffer()
      posAttr = system.gl.getAttribLocation(program, "posIn")
      fragCoordBuf = system.gl.createBuffer()
      fragCoordAttr = system.gl.getAttribLocation(program, "fragCoordIn")
      timeUnif = system.gl.getUniformLocation(program, "iTime")
      eventTimeUnif = system.gl.getUniformLocation(program, "eventTime")
      valueUnif = system.gl.getUniformLocation(program, "value")
      ampUnif = system.gl.getUniformLocation(program, "amp")
    }
    system.add(startTime, (state) => {
      let eventTime = ((state.time-startTime)/(endTime-startTime))
      system.gl.useProgram(program)
      let vtxData = system.fullscreenVtxs()
      system.loadVertexAttrib(posBuf, posAttr, vtxData.vtx, 2)
      system.loadVertexAttrib(fragCoordBuf, fragCoordAttr, vtxData.tex, 2)
      system.gl.uniform1f(timeUnif, state.time*rate, 1);
      system.gl.uniform1f(eventTimeUnif, eventTime, 1);
      system.gl.uniform1f(valueUnif, value, 1);
      system.gl.uniform1f(ampUnif, amp, 1);
      system.gl.enable(system.gl.BLEND)
      system.gl.blendFunc(system.gl.ONE, system.gl.ONE_MINUS_SRC_ALPHA)
      system.gl.drawArrays(system.gl.TRIANGLES, 0, 6)
      return state.time < endTime
    })
  }
})
