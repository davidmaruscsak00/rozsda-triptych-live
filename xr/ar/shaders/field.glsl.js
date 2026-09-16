import { SWIRL } from './swirl.glsl.js';

// the hallucination: a dense swirl of velocity-aligned rectangular slabs
export const FIELD_VS = `#version 300 es
uniform sampler2D u_paint;
uniform vec2  u_imgSize;
uniform vec2  u_res;
uniform float u_aspect;
uniform float u_sep;
uniform float u_ftime;     // flow clock: frozen while the painting is intact
uniform float u_drift;
uniform float u_dist;
uniform float u_nMain;     // seeds beyond this fill the hinge wedges
uniform float u_nWedgeHalf;
uniform float u_boxFront;  // frame front rim (unfolded z)
uniform float u_boxBack;   // frame back plane (unfolded z)
// One record per chip, consumed as instanced attributes by bl-vs.
out vec4 o_A;              // folded centre        + width
out vec4 o_B;              // folded forward axis  + height
out vec4 o_C;              // folded side axis     + thickness
out vec4 o_D;              // colour (ao applied)  + glint weight (ao applied)

${SWIRL}

// a chip's whole journey as one path: rest -> broad swell -> deep box relief
vec3 chipPath(vec3 rest, vec2 uv, float wA, float wB, float turb, float t) {
  vec3 disp = mix(waveField(uv, t) * wA, boxField(uv, t), wB);
  vec3 p = rest + disp;
  // turbulence sampled on the wall plane only: every chip in a depth column
  // (and the painting piece in front of it) shares the same twist, so depth
  // ordering is preserved and nothing punches through from behind
  p += (turb * 45.0 * wB) * curlT(vec3(rest.xy, 0.0) * 0.003, t * 0.20);
  p.z -= 150.0 * sin(wB * 3.14159);
  return p;
}

void main() {
  float fi = float(gl_VertexID);
  vec4 h = vec4(hash11(fi * 0.1031 + 0.71), hash11(fi * 0.2237 + 4.13),
                hash11(fi * 0.3169 + 8.59), hash11(fi * 0.4721 + 1.37));
  float h5 = hash11(fi * 0.5893 + 6.53);
  float h6 = hash11(fi * 0.6311 + 3.19);

  // resting state: randomly scattered inside a shallow box that matches the
  // painting's width and height, hovering just behind the wall
  float rA = hash11(fi * 0.7717 + 2.11);
  float rB = hash11(fi * 0.8391 + 8.47);
  float rC = hash11(fi * 0.9133 + 5.03);
  float rD = hash11(fi * 1.0477 + 7.61);
  // spread across the whole unfolded triptych sheet: [-W/2 .. 3W/2].
  // seeds past u_nMain instead fill the wedge-shaped voids behind the two
  // hinges, fanning between the neighbouring panels' depth directions
  bool wedge = fi >= u_nMain;
  float theta = 0.0;
  vec2 restXY;
  if (wedge) {
    float hingeX = (fi - u_nMain) < u_nWedgeHalf ? 0.0 : u_imgSize.x;
    theta = rA * 0.7853982 * (hingeX == 0.0 ? 1.0 : -1.0);
    restXY = vec2(hingeX, rB * u_imgSize.y);
  } else {
    restXY = vec2((rA * 2.0 - 0.5) * u_imgSize.x, rB * u_imgSize.y);
  }
  vec3 rest = vec3(restXY, 45.0 + rC * 150.0);
  vec2 uv = restXY / u_imgSize;
  float um = uv.x < 0.0 ? -uv.x : (uv.x > 1.0 ? 2.0 - uv.x : uv.x);  // mirrored continuation

  // how far the awakening has reached this spot: first the wave, then the swirl
  // the swell carries no jitter, exactly as for the pieces in front
  float wA = smoothstep(0.0, 0.55, activation(uv, u_sep, u_ftime, 0.0));
  float wB = smoothstep(0.50, 1.0, activation(uv, u_sep, u_ftime, h.x));

  float turb = 0.55 + 0.65 * u_drift;
  float dt = 0.30;
  vec3 p1 = chipPath(rest, uv, wA, wB, turb, u_ftime - dt);
  vec3 p2 = chipPath(rest, uv, wA, wB, turb, u_ftime + dt);
  vec3 pos = 0.5 * (p1 + p2);
  vec3 vel = (p2 - p1) / (2.0 * dt);
  float spd = length(vel);

  // collide with the frame box: while inside its depth, stay within the
  // opening; escaping is only possible out the front. The back is solid.
  float cw = smoothstep(u_boxFront - 30.0, u_boxFront + 30.0, pos.z);
  vec2 lo = vec2(-0.5 * u_imgSize.x + 45.0, 45.0);
  vec2 hi = vec2(1.5 * u_imgSize.x - 45.0, u_imgSize.y - 45.0);
  pos.xy = mix(pos.xy, clamp(pos.xy, lo, hi), cw);
  // pressed into the back, chips keep their rest depth order instead of all
  // landing on one plane, where they would z-fight each other
  pos.z = min(pos.z, u_boxBack - 55.0 + 30.0 * rC);

  // local slope of the combined surface, to lay chips tangent to it
  vec2 eps = vec2(60.0) / u_imgSize;
  #define ZAT(q) mix(waveField(q, u_ftime).z * wA, boxField(q, u_ftime).z, wB)
  vec2 grad = vec2(
      ZAT(uv + vec2(eps.x, 0.0)) - ZAT(uv - vec2(eps.x, 0.0)),
      ZAT(uv + vec2(0.0, eps.y)) - ZAT(uv - vec2(0.0, eps.y))) / 120.0;

  // rest frame: flat chip with loose scatter, tilted onto the wave surface
  float ra = (rD - 0.5) * 0.9;
  float rc = cos(ra), rs = sin(ra);
  mat2 RR = mat2(rc, -rs, rs, rc);
  vec2 fr2 = RR * vec2(1.0, 0.0), sr2 = RR * vec2(0.0, 1.0);
  vec3 fR = normalize(vec3(fr2, dot(grad, fr2)));
  vec3 sR = normalize(vec3(sr2, dot(grad, sr2)));

  // lean into the full 3D direction of travel — including in/out z motion —
  // as soon as the surface moves; relax onto it when still
  float ovel = clamp(spd / 90.0, 0.0, 1.0) * 0.9;
  vec3 fV = spd > 1e-3 ? vel / spd : fR;
  vec3 hint = normalize(vec3(h5, h6, h.x) - 0.5 + 1e-3);
  vec3 sV = normalize(cross(fV, hint));
  vec3 f = normalize(mix(fR, fV, ovel));
  vec3 s0 = mix(sR, sV, ovel);
  vec3 s = normalize(s0 - f * dot(s0, f));
  vec3 u2 = cross(f, s);

  float stretch = 1.0 + clamp(spd * 0.004, 0.0, 0.8) * wB;
  vec3 dims = vec3(mix(20.0, 36.0, h5) * stretch, mix(9.0, 16.0, h6), mix(2.8, 5.0, h.y));
  // fold the unfolded-sheet result into the angled triptych panel; wedge
  // fillers get an intermediate hinge rotation instead of a panel's
  mat3 Mp;
  vec3 hW;
  if (wedge) {
    float ct = cos(theta), st = sin(theta);
    Mp = mat3(vec3(ct, 0.0, st), vec3(0.0, 1.0, 0.0), vec3(-st, 0.0, ct));
    hW = vec3(rest.x, 0.0, 0.0);
  } else {
    Mp = panelM(rest.x, u_imgSize.x);
    hW = panelH(rest.x, u_imgSize.x);
  }

  // colour: unchanged from index.html, but evaluated once per chip instead of
  // once per vertex. The texture fetch alone was running ~53x too often.
  vec3 pcolR = texture(u_paint, clamp(vec2(um, uv.y), 0.0, 1.0)).rgb;
  float crest = clamp((rest.z - pos.z) / 300.0, 0.0, 1.0);
  vec3 restCol = pcolR * (0.55 + 0.75 * crest * wA) * (1.0 - rC * 0.5);
  float ridge = clamp((rest.z - pos.z) / 560.0, 0.0, 1.0);
  float e2 = ridge * 0.85 + clamp(spd / 200.0, 0.0, 1.0) * 0.25;
  float plum = dot(pcolR, vec3(0.299, 0.587, 0.114));
  vec3 vivid = clamp(mix(vec3(plum), pcolR, 1.35), 0.0, 1.0);
  vec3 col = vivid * (0.30 + 1.05 * smoothstep(0.0, 0.8, e2 + 0.15 * h6));
  col = mix(col, vec3(0.98, 0.96, 0.90), smoothstep(0.72, 1.0, e2) * 0.35);
  col *= 0.90 + 0.20 * h5;
  col = mix(restCol, col, wB);

  // occlusion: light enters the mass from the front, so how deep a chip sits in
  // the frame box stands in for how much of its hemisphere neighbours block.
  float burial = clamp((pos.z - u_boxFront) / (u_boxBack - u_boxFront), 0.0, 1.0);
  float ao = mix(1.0, 0.26, burial * burial);

  // Mp is a rotation, so folding the basis is the same as folding the vertex
  // afterwards, and the third axis is recovered as a cross product downstream.
  // ao rides in the colour and the glint weight, freeing each vec4's .w slot.
  o_A = vec4(hW + Mp * (pos - hW), dims.x);
  o_B = vec4(Mp * f, dims.y);
  o_C = vec4(Mp * s, dims.z);
  o_D = vec4(col * ao, (0.30 + 0.24 * h5) * ao);
}
`;
