#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  vec2 uv = preprocess(fragCoord);

  float f = max(min((1.0-uv.y)/2.0, 1.0), 0.0);

  postprocess(vec4(1.), pow(f, l_amp));
}
