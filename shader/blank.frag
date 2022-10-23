#version 300 es
precision mediump float;

in vec2 fragCoord;
uniform float l_value;
uniform float l_amp;

#insert common-processors

void main() {
  postprocess(vec4(1.), 0.0);
}
