import { SWIRL } from './swirl.glsl.js';
import { LIGHT } from './light.glsl.js';
import { RELIEF } from './relief.glsl.js';

// the painting's own surface, just behind the pieces' front faces: fills the
// cracks between pieces and gives the painting straight edges while it rests
export const CANVAS_VS = `#version 300 es
uniform mat4 u_viewProj;
uniform vec2 u_imgSize;
in vec3 a_pos;             // already folded into its panel
in vec3 a_norm;
in vec2 a_sheet;           // position on the unfolded sheet, in painting px
out vec2 v_sheet;
out vec3 v_norm;
out vec3 v_wpos;

${RELIEF}

void main() {
  // the Judit facade raises the centre panel's surface toward the viewer
  // (the wings lie outside its rectangle, so they stay flat)
  vec3 p = a_pos;
  float rh = reliefH(a_sheet);
  p.z -= rh;
  vec3 n = a_norm;
  if (rh > 0.0) {
    vec2 g = reliefGrad(a_sheet);
    n = normalize(vec3(-g, -1.0));
  }
  v_wpos = p;
  v_sheet = a_sheet;
  v_norm = n;
  gl_Position = u_viewProj * vec4(p, 1.0);
}
`;

export const CANVAS_FS = `#version 300 es
precision highp float;
uniform sampler2D u_paint;
uniform vec2  u_imgSize;
uniform float u_sep;
uniform float u_ftime;
uniform vec3  u_camPos;
in vec2 v_sheet;
in vec3 v_norm;
in vec3 v_wpos;
out vec4 outColor;

${SWIRL}
${LIGHT}

void main() {
  float W = u_imgSize.x;
  vec2 uv = v_sheet / u_imgSize;
  float um = uv.x < 0.0 ? -uv.x : (uv.x > 1.0 ? 2.0 - uv.x : uv.x);  // mirrored wings

  // gone as soon as the swell reaches this spot. The pieces' swell uses the
  // same unjittered activation, so wherever this survives they are all at rest.
  if (activation(uv, u_sep, u_ftime, 0.0) > 0.0) discard;

  // lit exactly like a resting piece's front face, so the seams vanish
  vec3 N = normalize(v_norm);
  float vis = lightVis(v_wpos + N * 2.0, 0.0012);
  vec3 col = shadePaint(texture(u_paint, vec2(um, uv.y)).rgb, N, normalize(u_camPos - v_wpos), vis);
  outColor = vec4(col, 1.0);
}
`;
