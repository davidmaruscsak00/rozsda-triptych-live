import { SWIRL } from './swirl.glsl.js';
import { CYCLE } from './cycle.glsl.js';
import { XFORM_READ } from './xform.glsl.js';
import { LIGHT } from './light.glsl.js';
import { RELIEF } from './relief.glsl.js';

// ---- simulation ----------------------------------------------------------
// Stage two of the decomposition. One transform-feedback step per frame for
// every particle. A particle sits on its piece (wherever that piece has flown)
// until the piece has broken off and its spot crumbles; then it lifts off and
// moves by a blend of two motions: hovering in a slowly turning cloud in front
// of its piece, or carried by the swirl that follows the triptych (the Swirl
// slider), colliding with the frame. When the spot
// grows back it flies home onto the piece, still moving.
export const SIM_VS = `#version 300 es
layout(location = 0) in vec4 a_s0;   // position, time in flight (0 = on its piece)
layout(location = 1) in vec4 a_s1;   // velocity, crumble hold at home
layout(location = 2) in vec4 a_home; // position on the piece (piece-local px), piece index
layout(location = 3) in vec4 a_src;  // home pixel in the painting, two randoms

uniform vec2  u_imgSize;
uniform float u_time;
uniform float u_dt;
uniform float u_drift;               // turbulence toggle
uniform float u_floorY;              // the real floor, in painting px (y down)
uniform float u_np;                  // pieces per panel
uniform float u_crumble;
uniform float u_ctime;               // crumble clock
uniform float u_swirl;               // 0 hover near the piece .. 1 the swirl along the triptych
uniform float u_frameFront;          // frame box depth, sheet z
uniform float u_frameBack;
uniform float u_frameW;              // rail width
uniform sampler2D u_fluid;           // water velocity over the sheet, px/s
uniform vec2  u_fluidOrigin;         // sheet px at fluid uv 0
uniform vec2  u_fluidSize;           // sheet px the fluid grid spans
uniform float u_gravity;             // 0 weightless .. 1 drips and pools

out vec4 o_s0;
out vec4 o_s1;

${SWIRL}
${CYCLE}
${XFORM_READ}
${RELIEF}

// ---- the triptych's own frame of reference --------------------------------
// A folded point belongs to the panel whose surface it faces: the half-spaces
// split by the planes bisecting each hinge. In a panel's local frame x runs
// along the unfolded sheet (-W/2 .. 3W/2), y down the painting, z out of the
// surface (negative toward the viewer), so the swirl can follow the fold.
const float C45 = 0.70710678;
float panelOf(vec3 p) {
  float W = u_imgSize.x;
  if (p.x * (1.0 + C45) + p.z * C45 < 0.0) return 1.0;
  if ((p.x - W) * (-1.0 - C45) + p.z * C45 < 0.0) return 2.0;
  return 0.0;
}
mat3 panelFold(float panel) {
  if (panel < 0.5) return mat3(1.0);
  if (panel < 1.5) return mat3(vec3(C45, 0.0, C45), vec3(0.0, 1.0, 0.0), vec3(-C45, 0.0, C45));
  return mat3(vec3(C45, 0.0, -C45), vec3(0.0, 1.0, 0.0), vec3(C45, 0.0, C45));
}
vec3 panelHinge(float panel) { return vec3(panel > 1.5 ? u_imgSize.x : 0.0, 0.0, 0.0); }
vec3 toSheet(vec3 p, float panel) {
  return panelHinge(panel) + transpose(panelFold(panel)) * (p - panelHinge(panel));
}
vec3 fromSheet(vec3 q, float panel) {
  return panelHinge(panel) + panelFold(panel) * (q - panelHinge(panel));
}

// ---- the water, following the triptych ---------------------------------------
// Along the surface: the fluid solver's velocity over the unfolded sheet (so its
// eddies wrap around the hinges), with a little 3D turbulence. Out of the
// surface: particles hug it, and a slow noise lets tendrils reach far into the
// room in places. Returned in sheet axes.
vec3 sheetFlow(vec3 q, float t) {
  float W = u_imgSize.x, H = u_imgSize.y;
  vec2 fuv = (q.xy - u_fluidOrigin) / u_fluidSize;
  vec3 v = vec3(texture(u_fluid, fuv).xy, 0.0);
  float turb = 0.6 + 0.6 * u_drift;
  v += turb * 22.0 * curlT(q * 0.006, t * 0.3);
  // keep to the sheet's silhouette; under gravity the bottom is left to the
  // frame and the floor, so particles can fall and pool
  v.x += (clamp(q.x, -0.5 * W + 60.0, 1.5 * W - 60.0) - q.x) * 1.2;
  v.y += (clamp(q.y, 60.0, H - 60.0) - q.y) * 1.2 * (q.y < 60.0 ? 1.0 : 1.0 - u_gravity);
  // depth: close to the surface, with the odd tendril reaching out; over the
  // Judit facade they hug its relief and slide along the face
  float n = 0.5 + 0.5 * sin(q.x * 0.0062 + t * 0.17) * sin(q.y * 0.0081 - t * 0.14 + 1.7);
  float rh = reliefH(q.xy);
  float reach = mix(50.0 + 720.0 * n * n, 14.0 + 40.0 * n, clamp(rh / 40.0, 0.0, 1.0));
  v.z += (-rh - reach - q.z) * 0.9;
  return v;
}

// ---- collision with the frame -----------------------------------------------
// In sheet coordinates the frame is a few boxes: rails above and below the
// whole sheet, uprights at the wing tips, the back panel, all spanning the
// frame's depth. A particle found inside is pushed out through the nearest
// face and bounces softly.
void collideFrame(inout vec3 p, inout vec3 v) {
  float W = u_imgSize.x, H = u_imgSize.y;
  float panel = panelOf(p);
  vec3 q = toSheet(p, panel);
  vec3 u = transpose(panelFold(panel)) * v;
  const float m = 3.0;
  bool inDepth = q.z > u_frameFront && q.z < u_frameBack;
  bool inOuter = q.x > -0.5 * W - u_frameW && q.x < 1.5 * W + u_frameW
              && q.y > -u_frameW && q.y < H + u_frameW;
  if (!inDepth || !inOuter) return;
  bool inOpening = q.y > 0.0 && q.y < H && q.z < u_frameBack - 28.0
                && (panel != 1.0 || q.x > -0.5 * W) && (panel != 2.0 || q.x < 1.5 * W);
  if (inOpening) return;
  // candidate exits and how far each is
  float best = q.z - u_frameFront; vec3 nrm = vec3(0.0, 0.0, -1.0);   // out the front
  float dTop = min(abs(q.y), abs(q.y + u_frameW));
  if (q.y < 0.0 && dTop < best) { best = dTop; nrm = abs(q.y) < abs(q.y + u_frameW) ? vec3(0, 1, 0) : vec3(0, -1, 0); }
  float dBot = min(abs(q.y - H), abs(q.y - H - u_frameW));
  if (q.y > H && dBot < best) { best = dBot; nrm = abs(q.y - H) < abs(q.y - H - u_frameW) ? vec3(0, -1, 0) : vec3(0, 1, 0); }
  if (panel == 1.0 && q.x < -0.5 * W) {
    float dIn = -0.5 * W - q.x, dOut = q.x + 0.5 * W + u_frameW;
    if (min(dIn, dOut) < best) { best = min(dIn, dOut); nrm = dIn < dOut ? vec3(1, 0, 0) : vec3(-1, 0, 0); }
  }
  if (panel == 2.0 && q.x > 1.5 * W) {
    float dIn = q.x - 1.5 * W, dOut = 1.5 * W + u_frameW - q.x;
    if (min(dIn, dOut) < best) { best = min(dIn, dOut); nrm = dIn < dOut ? vec3(-1, 0, 0) : vec3(1, 0, 0); }
  }
  if (q.z > u_frameBack - 28.0 && q.y > 0.0 && q.y < H) {
    float dBack = q.z - (u_frameBack - 28.0);
    if (dBack < best) { best = dBack; nrm = vec3(0, 0, -1); }
  }
  q += nrm * (best + m);
  float vn = dot(u, nrm);
  if (vn < 0.0) u -= nrm * vn * 1.35;                     // soft bounce
  u *= 0.9;
  p = fromSheet(q, panel);
  v = panelFold(panel) * u;
}

// the hover: each particle keeps a place in a cloud in front of its own piece,
// orbiting the cloud's centre about the vertical, flattened in depth, with a
// little turbulence; the velocity steers it toward that moving place
vec3 hoverVel(vec3 p, PieceXf xf, float pieceIdx, float t) {
  float hp = cycHash3(vec3(pieceIdx, 3.7, 1.1)), hs = cycHash3(vec3(pieceIdx, 8.3, 5.9));
  vec3 cloud = xf.c - xf.u * (110.0 + 150.0 * hp);
  vec3 dir = normalize(vec3(a_src.z, a_src.w, fract(a_src.z * 7.13 + a_src.w)) - 0.5 + 1e-4);
  vec3 off = dir * mix(40.0, 130.0, sqrt(fract(a_src.w * 3.17)));
  float ang = t * mix(0.25, 0.6, hp) * (hs > 0.5 ? 1.0 : -1.0) + a_src.w * 6.2831853;
  float c = cos(ang), s = sin(ang);
  off = vec3(c * off.x + s * off.z, off.y, (-s * off.x + c * off.z) * 0.6);
  vec3 target = cloud + off + 22.0 * curlT(off * 0.012 + hp * 7.0, t * 0.35);
  return (target - p) * 2.4;
}

void main() {
  vec3 pos = a_s0.xyz, vel = a_s1.xyz;
  float age = a_s0.w;
  float idx = a_home.w;
  PieceXf xf = pieceXform(idx);
  vec3 lp = a_home.xyz * xf.scale;
  vec3 home = xf.c + xf.f * lp.x + xf.s * lp.y + xf.u * lp.z;
  float panel = floor(idx / u_np);
  // only a piece that has broken off crumbles
  // on the facade the grains leave on their own while the pieces hold solid
  float amount = u_crumble * smoothstep(0.5, 1.0, max(xf.wB, xf.form));
  float hold = surfaceHold(a_src.xy, panel, amount, u_ctime);
  // each grain has its own threshold, weighted so only a few shed at first
  // and more follow as the crumble deepens (see RELEASE_SPAN)
  float released = step(RELEASE_SPAN * sqrt(fract(a_src.z * 91.7 + a_src.w * 13.1)), -hold);

  if (released > 0.5) {
    if (age <= 0.0) {
      // drift off the piece's face, barely: the water does the rest
      vec3 jit = vec3(a_src.z, a_src.w, fract(a_src.z * 7.13 + a_src.w)) - 0.5;
      vel = -xf.u * mix(6.0, 28.0, a_src.w) + jit * 14.0;
      pos = home;
      age = 1e-3;
    }
    age += u_dt;
    // inertia: each particle eases into the flow at its own rate, so neighbours
    // separate into strands instead of moving as a block
    float pnl = panelOf(pos);
    vec3 swirl = panelFold(pnl) * sheetFlow(toSheet(pos, pnl), u_time);
    vec3 flow = mix(hoverVel(pos, xf, idx, u_time), swirl, u_swirl);
    float k = 1.0 - exp(-u_dt * mix(1.2, 3.2, a_src.z));
    vel = mix(vel, flow, k);
    // weightless: skim above the floor. Heavy: fall, the drag of the water
    // setting how fast, and pool on the rail and the floor.
    vel.y += (min(pos.y, u_floorY - 60.0) - pos.y) * 2.5 * k * (1.0 - u_gravity);
    vel.y += u_gravity * 420.0 * u_dt;
    pos += vel * u_dt;
    if (pos.y > u_floorY - 4.0) {
      pos.y = u_floorY - 4.0;
      vel.y = min(vel.y, 0.0);
      vel.xz *= 1.0 - min(u_dt * 3.0, 1.0);                  // friction on the floor
    }
    // never through the face: slide over it
    if (panelOf(pos) < 0.5) {
      float rhp = reliefH(pos.xy);
      if (rhp > 0.0 && pos.z > -rhp - 3.0) { pos.z = -rhp - 3.0; vel.z = min(vel.z, 0.0); }
    }
    collideFrame(pos, vel);
  } else if (age > 0.0) {
    // the spot has grown back: fly home onto the moving piece, then settle
    vec3 toHome = home - pos;
    float k = 1.0 - exp(-u_dt * 5.0);
    vel = mix(vel, toHome * mix(2.2, 3.4, a_src.w), k);
    pos += vel * u_dt;
    age += u_dt;
    if (dot(toHome, toHome) < 9.0) { pos = home; vel = vec3(0.0); age = 0.0; }
  } else {
    pos = home; vel = vec3(0.0);
  }
  o_s0 = vec4(pos, age);
  o_s1 = vec4(vel, hold);
}
`;

// ---- drawing -------------------------------------------------------------
export const PARTICLES_VS = `#version 300 es
layout(location = 0) in vec4 a_s0;
layout(location = 1) in vec4 a_s1;
layout(location = 2) in vec4 a_home;
layout(location = 3) in vec4 a_src;

uniform mat4  u_viewProj;
uniform sampler2D u_paint;
uniform vec2  u_imgSize;
uniform float u_vpH;       // viewport height in px, for perspective point size
uniform float u_sizeScale; // 1 when shading; larger in the thinned shadow pass
uniform vec3  u_camPos;    // eye, in painting space
uniform float u_lit;       // 1 when shading, 0 in the shadow pass

out vec3 v_col;

${CYCLE}
${LIGHT}

void main() {
  float age = a_s0.w, hold = a_s1.w;
  // hidden while it is still part of the solid surface
  if (age <= 0.0 && hold > -SURFACE_AT) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_col = vec3(0.0);
    return;
  }
  gl_Position = u_viewProj * vec4(a_s0.xyz, 1.0);

  // mostly fine dust with the odd larger fleck; flecks crumble finer with age
  float r1 = a_src.z, r2 = a_src.w;
  float sizePx = mix(1.6, 3.4, r1 * r1) + (r2 > 0.92 ? 3.5 * (r2 - 0.92) / 0.08 : 0.0);
  sizePx *= mix(1.35, 0.8, clamp(age / 6.0, 0.0, 1.0));
  vec3 row1 = vec3(u_viewProj[0][1], u_viewProj[1][1], u_viewProj[2][1]);
  gl_PointSize = max(u_sizeScale * sizePx * length(row1) * 0.5 * u_vpH / gl_Position.w, 1.0);

  // its own paint colour, pushed a little because fine dust averages toward
  // grey on screen; a sparkle on the flecks, and dust that has travelled far
  // catching slightly more light
  vec3 col = texture(u_paint, a_src.xy / u_imgSize).rgb;
  col = clamp(mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.45), 0.0, 1.0);
  float lift = clamp(-a_s0.z / 600.0, 0.0, 1.0);
  col *= mix(0.85, 1.15, fract(r1 * 13.7)) * (1.0 + 0.25 * lift);
  col += vec3(1.0, 0.92, 0.78) * (r2 > 0.97 ? 0.35 : 0.0);
  if (u_lit > 0.5) {
    // a grain is a tiny sphere: half its surface faces the light, so ambient
    // plus a diffuse share, dimmed where pieces or other particles shade it.
    // Seen against the light, fine dust scatters it forward and glows.
    float vis = lightVis(a_s0.xyz, 0.004);
    vec3 V = normalize(u_camPos - a_s0.xyz);
    float forward = pow(max(dot(-V, u_lightDir), 0.0), 6.0);
    col *= hemiAmbient(vec3(0.0, -1.0, 0.0)) * 0.55 + LIGHT_COL * vis * (0.62 + 0.9 * forward);
  }
  v_col = col;
}
`;

// a soft round dot. Alpha drives MSAA coverage (alpha-to-coverage), so the
// edge is soft without sorting or blending.
export const PARTICLES_FS = `#version 300 es
precision highp float;
in vec3 v_col;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  outColor = vec4(v_col, 1.0 - smoothstep(0.25, 1.0, r2));
}
`;
