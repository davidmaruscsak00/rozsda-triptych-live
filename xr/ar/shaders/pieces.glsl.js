import { CYCLE } from './cycle.glsl.js';
import { XFORM_READ } from './xform.glsl.js';
import { LIGHT } from './light.glsl.js';

// extruded pieces. Stage one: they swell, peel off and fly as solid pieces
// (their transform comes from the xform pass). Stage two: once broken off,
// they crumble into particles where the crumble field says so, and fill back
// in where it grows back.
export const PIECES_VS = `#version 300 es
uniform vec2  u_imgSize;
uniform int   u_panel;     // 0 center, 1 left wing (mirrored), 2 right wing
uniform float u_np;        // pieces per panel
uniform mat4  u_viewProj;  // eye projection * eye view * worldFromPainting

in vec3 a_pos;
in vec3 a_norm;
in vec4 a_cen;             // centroid (painting px), T/2, piece index + 1

out vec3 v_norm;
out vec3 v_wpos;
out vec2 v_srcPx;
flat out float v_face;
flat out float v_panel;
flat out float v_wB;
flat out float v_form;

${XFORM_READ}

void main() {
  // wings carry the mirrored continuation of the nearest half of the painting
  float W = u_imgSize.x;
  vec3 localP = a_pos - a_cen.xyz;
  vec3 normP = a_norm;
  if (u_panel == 1) {
    if (a_cen.x > 0.5 * W + 60.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    localP.x = -localP.x; normP.x = -normP.x;
  } else if (u_panel == 2) {
    if (a_cen.x < 0.5 * W - 60.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
    localP.x = -localP.x; normP.x = -normP.x;
  }

  PieceXf xf = pieceXform(a_cen.w - 1.0 + float(u_panel) * u_np);
  vec3 lp = localP * xf.scale;
  vec3 pos = xf.c + xf.f * lp.x + xf.s * lp.y + xf.u * lp.z;

  v_norm = xf.f * normP.x + xf.s * normP.y + xf.u * normP.z;
  v_wpos = pos;
  v_srcPx = a_pos.xy;
  v_face = a_norm.z < -0.5 ? 0.0 : (a_norm.z > 0.5 ? 2.0 : 1.0);
  v_panel = float(u_panel);
  v_wB = xf.wB;
  v_form = xf.form;
  gl_Position = u_viewProj * vec4(pos, 1.0);
}
`;

// the crumble test, shared by the shaded and the depth-only pass so a piece's
// shadow thins exactly as the piece does. Only pieces that have broken off
// crumble. Returns how close this point is to crumbling (0 = on the edge).
const ERODE = `
${CYCLE}
float erode() {
  // pieces on the raised facade hold together
  float amount = u_crumble * smoothstep(0.5, 1.0, v_wB) * (1.0 - v_form);
  float gap = surfaceHold(v_srcPx, v_panel, amount, u_ctime) + SURFACE_AT;
  if (gap < 0.0) discard;
  return smoothstep(0.0, 0.04, gap);
}
`;

export const PIECES_FS = `#version 300 es
precision highp float;
uniform sampler2D u_paint;
uniform vec2  u_imgSize;
uniform float u_crumble;
uniform float u_ctime;     // crumble clock: its speed is the Rhythm slider
uniform vec3  u_camPos;    // eye, in painting space

in vec3 v_norm;
in vec3 v_wpos;
in vec2 v_srcPx;
flat in float v_face;
flat in float v_panel;
flat in float v_wB;
flat in float v_form;
out vec4 outColor;

${ERODE}
${LIGHT}

void main() {
  float front = erode();

  vec3 N = normalize(v_norm);
  vec3 V = normalize(u_camPos - v_wpos);
  vec3 albedo;
  if (v_face < 0.5) {
    albedo = texture(u_paint, v_srcPx / u_imgSize).rgb;
  } else if (v_face < 1.5) {
    albedo = texture(u_paint, v_srcPx / u_imgSize).rgb * 0.55 + vec3(0.10, 0.08, 0.06);
  } else {
    albedo = vec3(0.30, 0.24, 0.18);
  }
  // shadows from the frame, from pieces in front, from the particle cloud
  float vis = lightVis(v_wpos + N * 2.0, 0.0012);
  vec3 col = shadePaint(albedo, N, V, vis);
  // a faint warm rim right where the surface is crumbling
  col += vec3(1.0, 0.82, 0.55) * 0.35 * (1.0 - front);
  outColor = vec4(col, 1.0);
}
`;

export const PIECES_DEPTH_FS = `#version 300 es
precision highp float;
uniform float u_crumble;
uniform float u_ctime;
in vec2 v_srcPx;
flat in float v_panel;
flat in float v_wB;
flat in float v_form;
out vec4 o;

${ERODE}

void main() {
  erode();
  o = vec4(0.0);
}
`;
