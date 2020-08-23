precision mediump float;

varying vec2 fragCoord;
uniform float iTime;
uniform float brightness;
uniform float value;
uniform float amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord)*0.5;

  vec2 grid = abs(fract(uv*10.0)-0.5)*2.0;
  float f = max(grid.x, grid.y)*1.1;

  postprocess(vec4(1.), pow(f, 10.0));
}
