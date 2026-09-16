import { SWIRL } from './swirl.glsl.js';

// Stable fluids (Stam) on a grid laid over the unfolded triptych sheet: the
// water the particles swim in. Velocity is in sheet px per second. Each frame:
// advect, add forces (a slow stirring, and drag from the swelling and peeling
// pieces, so eddies shed off them), vorticity confinement to keep eddies
// alive, then a pressure projection so the flow stays incompressible.

export const FLUID_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_grid;       // cells
uniform vec2 u_cellPx;     // sheet px per cell
vec2 at(sampler2D t, ivec2 c) {
  return texelFetch(t, clamp(c, ivec2(0), ivec2(u_grid) - 1), 0).xy;
}
`;

export const ADVECT_FS = HEAD + `
uniform sampler2D u_vel;
uniform float u_dt;
void main() {
  vec2 v = texture(u_vel, v_uv).xy;
  vec2 back = v_uv - u_dt * v / (u_grid * u_cellPx);
  o = vec4(texture(u_vel, back).xy * exp(-u_dt * 0.8), 0.0, 1.0);
}
`;

export const FORCE_FS = HEAD + `
uniform sampler2D u_vel;
uniform float u_dt;
uniform float u_time;
uniform vec2  u_origin;    // sheet px at uv 0
uniform vec2  u_imgSize;
uniform float u_sep;
uniform float u_ftime;
${SWIRL}
void main() {
  vec2 v = texture(u_vel, v_uv).xy;
  vec2 q = u_origin + v_uv * u_grid * u_cellPx;              // sheet px
  vec2 uv = q / u_imgSize;

  // a slow stirring: the curl of a drifting stream function, so it adds
  // rotation without piling water up
  float e = 8.0;
  #define PSI(p) (sin(p.x * 0.0058 + u_time * 0.09) * sin(p.y * 0.0071 - u_time * 0.07) + 0.5 * sin((p.x * 0.7 + p.y * 0.7) * 0.013 + u_time * 0.15))
  vec2 stir = vec2(PSI((q + vec2(0.0, e))) - PSI((q - vec2(0.0, e))),
                   -(PSI((q + vec2(e, 0.0))) - PSI((q - vec2(e, 0.0))))) / (2.0 * e);
  v += u_dt * stir * 4000.0;

  // drag from the pieces: wherever the painting swells or peels, the water is
  // pulled along with the surface's own motion
  float wA = smoothstep(0.0, 0.55, activation(uv, u_sep, u_ftime, 0.0));
  float wB = smoothstep(0.50, 1.0, activation(uv, u_sep, u_ftime, 0.5));
  const float dt = 0.25;
  vec2 d1 = mix(waveField(uv, u_ftime + dt).xy * wA, boxField(uv, u_ftime + dt).xy, wB);
  vec2 d0 = mix(waveField(uv, u_ftime - dt).xy * wA, boxField(uv, u_ftime - dt).xy, wB);
  vec2 surf = (d1 - d0) / (2.0 * dt);
  v += (surf * 2.5 - v) * clamp(u_dt * 2.0 * max(wA, wB), 0.0, 1.0);
  o = vec4(v, 0.0, 1.0);
}
`;

export const CURL_FS = HEAD + `
uniform sampler2D u_vel;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float curl = (at(u_vel, c + ivec2(1, 0)).y - at(u_vel, c - ivec2(1, 0)).y) / (2.0 * u_cellPx.x)
             - (at(u_vel, c + ivec2(0, 1)).x - at(u_vel, c - ivec2(0, 1)).x) / (2.0 * u_cellPx.y);
  o = vec4(curl, 0.0, 0.0, 1.0);
}
`;

export const VORTICITY_FS = HEAD + `
uniform sampler2D u_vel;
uniform sampler2D u_curl;
uniform float u_dt;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float cL = abs(at(u_curl, c - ivec2(1, 0)).x), cR = abs(at(u_curl, c + ivec2(1, 0)).x);
  float cB = abs(at(u_curl, c - ivec2(0, 1)).x), cT = abs(at(u_curl, c + ivec2(0, 1)).x);
  float cc = at(u_curl, c).x;
  vec2 n = vec2(cR - cL, cT - cB);
  n /= length(n) + 1e-5;
  vec2 v = at(u_vel, c) + u_dt * 38.0 * vec2(n.y, -n.x) * cc * u_cellPx;
  o = vec4(v, 0.0, 1.0);
}
`;

export const DIVERGENCE_FS = HEAD + `
uniform sampler2D u_vel;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float div = (at(u_vel, c + ivec2(1, 0)).x - at(u_vel, c - ivec2(1, 0)).x) / (2.0 * u_cellPx.x)
            + (at(u_vel, c + ivec2(0, 1)).y - at(u_vel, c - ivec2(0, 1)).y) / (2.0 * u_cellPx.y);
  o = vec4(div, 0.0, 0.0, 1.0);
}
`;

export const JACOBI_FS = HEAD + `
uniform sampler2D u_pres;
uniform sampler2D u_div;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float h2 = u_cellPx.x * u_cellPx.y;
  float p = (at(u_pres, c - ivec2(1, 0)).x + at(u_pres, c + ivec2(1, 0)).x
           + at(u_pres, c - ivec2(0, 1)).x + at(u_pres, c + ivec2(0, 1)).x
           - at(u_div, c).x * h2) * 0.25;
  o = vec4(p, 0.0, 0.0, 1.0);
}
`;

export const PROJECT_FS = HEAD + `
uniform sampler2D u_vel;
uniform sampler2D u_pres;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 grad = vec2(at(u_pres, c + ivec2(1, 0)).x - at(u_pres, c - ivec2(1, 0)).x,
                   at(u_pres, c + ivec2(0, 1)).x - at(u_pres, c - ivec2(0, 1)).x) / (2.0 * u_cellPx);
  vec2 v = at(u_vel, c) - grad;
  // walls: the water does not leave the sheet
  ivec2 g = ivec2(u_grid) - 1;
  if (c.x == 0 || c.x == g.x) v.x = 0.0;
  if (c.y == 0 || c.y == g.y) v.y = 0.0;
  o = vec4(v, 0.0, 1.0);
}
`;
