import { LIGHT } from './light.glsl.js';

// the triptych frame
export const FRAME_VS = `#version 300 es
uniform vec2  u_imgSize;
uniform vec2  u_res;
uniform float u_aspect;
uniform float u_dist;
uniform vec3  u_camPos;
uniform mat4  u_viewProj;  // eye projection * eye view * worldFromPainting
in vec3 a_p;
in vec3 a_n;
out vec3 v_w;
out vec3 v_n;
void main() {
  v_w = a_p;
  v_n = a_n;
  gl_Position = u_viewProj * vec4(a_p, 1.0);
}
`;

// brushed aged brass: a metal has no diffuse colour of its own, it tints what
// it reflects. In AR there is no environment to reflect, so the room's sky and
// floor gradient stands in for it, and the one light gives the bright edge.
export const FRAME_FS = `#version 300 es
precision highp float;
uniform vec3  u_col;       // the metal's reflectance
uniform vec3  u_camPos;
in vec3 v_w;
in vec3 v_n;
out vec4 outColor;

${LIGHT}

float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec3 N = normalize(v_n);
  vec3 V = normalize(u_camPos - v_w);
  // brushed along the rails
  float grain = vnoise(vec2(v_w.x + v_w.z, v_w.y) * vec2(0.02, 0.9));
  vec3 F0 = u_col * (0.92 + 0.14 * grain);
  float vis = lightVis(v_w + N * 1.5, 0.0012);
  float ndv = max(dot(N, V), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0) * 0.5;
  vec3 R = reflect(-V, N);
  vec3 H = normalize(u_lightDir + V);
  float nh = max(dot(N, H), 0.0);
  vec3 col = F * hemiAmbient(R) * 1.5 * mix(0.6, 1.0, vis)
           + F0 * LIGHT_COL * max(dot(N, u_lightDir), 0.0) * vis * 0.3
           + F * LIGHT_COL * (2.2 * pow(nh, 80.0) + 0.25 * pow(nh, 10.0)) * vis;
  outColor = vec4(col, 1.0);
}
`;
