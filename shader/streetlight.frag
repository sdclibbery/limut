#version 300 es
// from https://www.shadertoy.com/view/4sSGDG
precision highp float;
in vec2 fragCoord;
uniform float iTime;
uniform float l_value;

#insert common-processors

struct Ray
{
	vec3 org;
	vec3 dir;
};
	
struct Hit
{
	float dist;
	float index;
};
	
float time;
float glowAmt;

float onOff(float a, float b, float c)
{
	return clamp(c*sin(time + a*cos(time*b)),0.,1.);
}

float glows(float index)
{
	return onOff(5.+index*0.5,index+3.,3.);
}
	
float box(vec3 pos, vec3 dims)
{
	pos = abs(pos) - dims;
	return max(max(pos.x,pos.y),pos.z);
}


Hit hitUnion(Hit h1, Hit h2)
{
    if (h1.dist < h2.dist){
        return h1;
    }
    return h2;
}
	
Hit scene(vec3 pos)
{
	Hit totalHit;
	totalHit.dist = 9000.;
	for (float i = 0.; i < 5.; i+=1.)
	{
		vec3 p = pos;
		float tof = time + i*0.5;
		p = vec3(p.x*sin(tof) + p.z*cos(tof), 
					   p.y,
					   p.x*cos(tof) - p.z*sin(tof));
		p += vec3(4.,0.,0.);
		
		tof*=1.3*i;
		p = vec3(p.x*sin(tof) + p.z*cos(tof), 
					   p.y,
					   p.x*cos(tof) - p.z*sin(tof));
		
		Hit h = Hit(box(p, vec3(.4*(l_value*0.1+1.),20.,.2)),i);
		totalHit = hitUnion(h,totalHit);
	}
	return totalHit;
}

Hit raymarch(Ray ray)
{
	vec3 pos;
	Hit hit;
	hit.dist = 0.;
	Hit curHit;
	for (int i = 0; i < 40; i++)
	{
		pos = ray.org + hit.dist * ray.dir;
		curHit = scene(pos);
		hit.dist += curHit.dist;
		glowAmt += clamp(pow(curHit.dist+0.1, -8.),0.,0.15)*glows(curHit.index);
		if (hit.dist > 21.) { break; }
	}
	hit.index = curHit.index;
	hit.index = curHit.dist < 0.01 ? hit.index : -1.;
	return hit;
}

vec3 calcNormal(vec3 pos)
{
	vec3 eps = vec3( 0.001, 0.0, 0.0 );
	vec3 nor = vec3(
	    scene(pos+eps.xyy).dist - scene(pos-eps.xyy).dist,
	    scene(pos+eps.yxy).dist - scene(pos-eps.yxy).dist,
	    scene(pos+eps.yyx).dist - scene(pos-eps.yyx).dist );
	return normalize(nor);
}

vec4 render(Ray ray)
{
	Hit hit = raymarch(ray);
	vec3 pos = ray.org + hit.dist*ray.dir;
	vec3 col = vec3(0.);
	if (hit.index != -1.)
	{
		vec3 nor = calcNormal(pos);
		vec3 l = normalize(vec3(3.,0.,0.) - pos);
		col = vec3(.3,.5,.7);
		
		float diff = clamp(dot(nor,l),0.,1.);
		vec3 r = normalize(2.*dot(nor,l)*nor-l);
		vec3 v = normalize(ray.org-pos);
		float spec = clamp(dot(v,r),0.,1.);
		float ao = 1.;
		col = diff*col*ao + pow(spec,10.)*vec3(1.)*ao + vec3(0.5,0.7,1.)*1.9*glows(hit.index);
		col*= clamp(1. - hit.dist*0.03,0.,1.);
	}
	col += clamp(glowAmt*0.4,0.,1.)*vec3(.3,.5,.7);
	return vec4(col, glowAmt);
}

Ray createRay(vec3 center, vec3 lookAt, vec3 up, vec2 uv, float fov, float aspect)
{
	Ray ray;
	ray.org = center;
	vec3 dir = normalize(lookAt - center);
	up = normalize(up - dir*dot(dir,up));
	vec3 right = cross(dir, up);
	uv = 2.*uv - vec2(1.);
	fov = fov * 3.1415/180.;
	ray.dir = dir + tan(fov/2.) * right * uv.x + tan(fov/2.) / aspect * up * uv.y;
	ray.dir = normalize(ray.dir);	
	return ray;
}

void main()
{	
	vec2 uv = preprocess(fragCoord.xy)*0.7+vec2(0.5, 1.0);
	glowAmt = 0.;
	time = iTime + uv.y*(0.17 + .14*clamp(sin(iTime*1.2)*2.,-1.,1.));
	vec3 cameraPos = vec3(6.,3.,-6.);
	vec3 lookAt = vec3(0.);
	vec3 up = vec3(sin(0.6*sin(time*1.4)),cos(0.6*sin(time*1.4)),0.);
	float aspect = 1.0;
	Ray ray = createRay(cameraPos, lookAt, up, uv, 90., aspect);
	vec4 col = render(ray);
	float f = col.a;
	col.a = 1.0;
  postprocess(col, f);
}