precision mediump float;
varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;
uniform vec4 fore;
uniform vec4 back;

#define MAXITERS 30
#define LENFACTOR 2.5
#define MINDIST 0.04
#define NDELTA 0.001

// metaballs ref:
// http://jamie-wong.com/2014/08/19/metaballs-and-marching-squares/

#define NDELTAX vec3(NDELTA, 0., 0.)
#define NDELTAY vec3(0., NDELTA, 0.)
#define NDELTAZ vec3(0., 0., NDELTA)

float rand(float n) {
	return fract(2634.2745 * (n + 3.263));
}
vec3 rand3(float n) {
    return vec3(rand(n * 363.34), rand(n * 73.25), rand(n * 3734.423));
}

float scene(vec3 p) {
    //float d = 10000.;
    float den = 0.;
    for (float i = .0; i < 5.; ++i) {
      vec3 speed = 2.0 * rand3(i*2.);
      vec3 range = rand3(i*10.) * 5. * amp;
      range.xy *= 1.5;
      vec3 c = sin(iTime * speed) * range + vec3(0., 1., 10.);
      vec3 dis = c - p;
      float x = dot(dis, dis);
      den += (1.0 + (value>10.?value/6.:value)/20.0) * 4.0 / x;
    }
    //return     pow(den, .25) - 2.;
    if (den < 0.333) return 2.;
    else return 1. / den - 1.;
}

vec3 sceneNormal(vec3 p) {
    return normalize(vec3(
        scene(p + NDELTAX) - scene(p - NDELTAX),
        scene(p + NDELTAY) - scene(p - NDELTAY),
        scene(p + NDELTAZ) - scene(p - NDELTAZ)
	));
}

void main()
{
	  vec2 uv = fragCoord;
    vec3 ray = normalize(vec3(uv, 1.));
    vec3 cam = vec3(0., 1., -0.3);

    vec3 pos = cam;
    float dist;
    for (int i = 0; i < MAXITERS; ++i) {
        dist = scene(pos);
        if (dist < MINDIST) break;
        pos += ray * dist * LENFACTOR;
    }

    vec4 col;
    if (dist < MINDIST) {
	    vec3 n = sceneNormal(pos);
      float spec = pow(clamp(dot(normalize(vec3(0.,1.,-1.)), reflect(normalize(pos), n)), 0., 1.), 20.0);
    	col.rgb = fore.rgb * 0.5 * (n.y + 1.) + vec3(spec*0.5);
      col.a = fore.a;
    } else {
      col = back;
    }

    gl_FragColor = col * brightness * col.a;
}
