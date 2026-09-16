import { SWIRL } from './swirl.glsl.js';
import { RELIEF } from './relief.glsl.js';

// Stage one of the decomposition: the painting breaks into pieces. Once per
// frame, every piece in every panel gets its transform written into three
// float textures (one texel each): folded centre and scale, then the first two
// axes of its folded orientation, plus how far it has peeled and how far it has
// risen into the Judit facade (Form). The
// pieces draw from these, and so do their particles, which is how a particle
// knows where its piece is right now.
export const XFORM_VS = `#version 300 es
uniform vec2  u_imgSize;
uniform float u_sep;
uniform float u_ftime;     // flow clock: frozen while the painting is intact
uniform float u_drift;
uniform float u_boxFront;
uniform float u_boxBack;
uniform float u_side;      // texture side, in texels
uniform float u_np;        // pieces per panel

in vec4 a_cen;             // centroid (painting px), T/2, piece index + 1

flat out vec4 v_x0;        // folded centre, scale
flat out vec4 v_x1;        // folded forward axis, peel (wB)
flat out vec4 v_x2;        // folded side axis, how much it belongs to the facade

${SWIRL}
${RELIEF}

void main() {
  float id = float(gl_VertexID);
  vec2 tc = vec2(mod(id, u_side), floor(id / u_side));
  gl_Position = vec4((tc + 0.5) / u_side * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;

  float panel = floor(id / u_np);
  float seed = a_cen.w;
  float h1 = hash11(seed * 1.618 + 0.7);
  float h2 = hash11(seed * 2.113 + 5.1);
  float h3 = hash11(seed * 3.719 + 9.3);

  // wings carry the mirrored continuation of the painting on the unfolded sheet
  float W = u_imgSize.x;
  vec3 cenU = a_cen.xyz;
  if (panel > 0.5) cenU.x = panel < 1.5 ? -a_cen.x : 2.0 * W - a_cen.x;

  // first the whole surface swells in broad slow waves (one coherent surface,
  // no per-piece jitter); only then does the swirl peel this patch away
  vec2 uvP = cenU.xy / u_imgSize;
  float wA = smoothstep(0.0, 0.55, activation(uvP, u_sep, u_ftime, 0.0));
  float wB = smoothstep(0.50, 1.0, activation(uvP, u_sep, u_ftime, h1));

  float turb = 0.55 + 0.65 * u_drift;
  vec3 disp = mix(waveField(uvP, u_ftime) * wA, boxField(uvP, u_ftime), wB);
  vec3 c = cenU + disp
         + (turb * 45.0 * wB) * curlT(vec3(cenU.xy, 0.0) * 0.003, u_ftime * 0.20);
  c.z -= 160.0 * sin(wB * 3.14159);                     // arc out on departure

  // the Judit facade: a resting piece in the centre panel sits on the relief;
  // once it peels off, it leaves the face behind
  float rh = reliefH(cenU.xy) * (1.0 - wB);
  c.z -= rh;

  // collide with the frame box. The bounds never pull a piece in past its own
  // rest position (border pieces stay flush while it rests), nor past the
  // painting's edge (wing-tip overlap would poke through the frame).
  float cwc = smoothstep(u_boxFront - 30.0, u_boxFront + 30.0, c.z);
  vec2 sheetLo = vec2(-0.5 * W, 0.0), sheetHi = vec2(1.5 * W, u_imgSize.y);
  vec2 boxLo = min(vec2(-0.5 * W + 70.0, 70.0), clamp(cenU.xy, sheetLo, sheetHi));
  vec2 boxHi = max(vec2(1.5 * W - 70.0, u_imgSize.y - 70.0), clamp(cenU.xy, sheetLo, sheetHi));
  c.xy = mix(c.xy, clamp(c.xy, boxLo, boxHi), cwc);
  c.z = min(c.z, u_boxBack - 80.0);

  // orient tangent to the folding surface, leaning into the direction of travel
  vec2 eps = vec2(60.0) / u_imgSize;
  #define ZATP(q) mix(waveField(q, u_ftime).z * wA, boxField(q, u_ftime).z, wB)
  vec2 grad = vec2(
      ZATP(uvP + vec2(eps.x, 0.0)) - ZATP(uvP - vec2(eps.x, 0.0)),
      ZATP(uvP + vec2(0.0, eps.y)) - ZATP(uvP - vec2(0.0, eps.y))) / 120.0;
  grad -= reliefGrad(cenU.xy) * (1.0 - wB);               // tilt with the face (z = -h)
  float dtv = 0.30;
  #define PDISP(tq) (mix(waveField(uvP, tq) * wA, boxField(uvP, tq), wB) + (turb * 45.0 * wB) * curlT(vec3(cenU.xy, 0.0) * 0.003, (tq) * 0.20))
  vec3 vel = (PDISP(u_ftime + dtv) - PDISP(u_ftime - dtv)) / (2.0 * dtv);
  float spd = length(vel);
  vec3 fR = normalize(vec3(1.0, 0.0, grad.x));
  vec3 sR = normalize(vec3(0.0, 1.0, grad.y));
  float ovel = clamp(spd / 90.0, 0.0, 1.0) * 0.9;
  vec3 fV = spd > 1e-3 ? vel / spd : fR;
  vec3 hintP = normalize(vec3(h1, h2, h3) - 0.5 + 1e-3);
  vec3 sV = normalize(cross(fV, hintP));
  vec3 fO = normalize(mix(fR, fV, ovel));
  vec3 s0m = mix(sR, sV, ovel);
  vec3 sO = normalize(s0m - fO * dot(s0m, fO));
  float scale = mix(1.0, 0.7, wB);                       // settle in a size down

  // fold into the angled triptych panel
  mat3 Mp = panelM(cenU.x, W);
  vec3 hW = panelH(cenU.x, W);
  vec3 cF = hW + Mp * (c - hW), fF = Mp * fO, sF = Mp * sO;
  v_x0 = vec4(cF, scale);
  v_x1 = vec4(fF, wB);
  // pieces on the raised face hold together: the facade stays solid while the
  // particles travel over it
  v_x2 = vec4(sF, rh > 1.0 ? u_form : 0.0);
}
`;

export const XFORM_FS = `#version 300 es
precision highp float;
flat in vec4 v_x0;
flat in vec4 v_x1;
flat in vec4 v_x2;
layout(location = 0) out vec4 o_x0;
layout(location = 1) out vec4 o_x1;
layout(location = 2) out vec4 o_x2;
void main() { o_x0 = v_x0; o_x1 = v_x1; o_x2 = v_x2; }
`;

// what a shader needs to read a piece's transform: declare the samplers and
// call pieceXform(index), index = piece index + panel * pieces per panel
export const XFORM_READ = `
uniform highp sampler2D u_xf0;
uniform highp sampler2D u_xf1;
uniform highp sampler2D u_xf2;
uniform float u_xfSide;
struct PieceXf { vec3 c; float scale; vec3 f; vec3 s; vec3 u; float wB; float form; };
PieceXf pieceXform(float idx) {
  ivec2 tc = ivec2(int(mod(idx, u_xfSide)), int(floor(idx / u_xfSide)));
  vec4 x0 = texelFetch(u_xf0, tc, 0), x1 = texelFetch(u_xf1, tc, 0), x2 = texelFetch(u_xf2, tc, 0);
  return PieceXf(x0.xyz, x0.w, x1.xyz, x2.xyz, cross(x1.xyz, x2.xyz), x1.w, x2.w);
}
`;
