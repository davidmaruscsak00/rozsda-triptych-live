// Which parts of the painting are apart right now. One slowly drifting noise
// field over the painting, shared by the pieces (erosion), the particles
// (release and return) and the canvas behind them (cover), so all three agree
// to the pixel. Regions come apart and grow back on their own; the slider sets
// how much of the painting is apart on average.
//
// panel is 0 centre, 1 left wing, 2 right wing, so the mirrored wings do not
// echo the centre. px is the original painting pixel.
import { qp } from '../config.js';

const NOISE = `
float cycHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float cycNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cycHash3(i), cycHash3(i + vec3(1, 0, 0)), f.x),
                 mix(cycHash3(i + vec3(0, 1, 0)), cycHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cycHash3(i + vec3(0, 0, 1)), cycHash3(i + vec3(1, 0, 1)), f.x),
                 mix(cycHash3(i + vec3(0, 1, 1)), cycHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// broad drifting regions, spread to roughly even coverage
float crumbleRegions(vec2 px, float panel, float t) {
  vec2 q = (px + vec2(1733.0, 977.0) * panel) / 430.0;
  float n = 0.60 * cycNoise3(vec3(q, t * 0.030))
          + 0.28 * cycNoise3(vec3(q * 2.7 + 5.2, t * 0.055))
          + 0.12 * cycNoise3(vec3(q * 8.3 + 1.7, t * 0.090));
  return clamp((n - 0.5) * 2.1 + 0.5, 0.0, 1.0);
}
// a static grain, so the edge crumbles
float crumbleGrain(vec2 px, float panel) {
  return cycNoise3(vec3(px / 3.2, panel * 7.0));
}
`;

// Crumbling is gradual. Below 0 a spot is coming apart; each grain leaves once
// the hold is below -RELEASE_SPAN * sqrt(its own random), so the share that
// has left grows with the square of the depth: a few grains first, then more.
// The solid surface only goes at -SURFACE_AT, when about three quarters of its
// grains are out; the last ones sit on as loose grains before they drift off.
const CONSTS = `
const float RELEASE_SPAN = 0.30;
const float SURFACE_AT = 0.26;
// a grain that rose again at the top of the waterfall counts its flight from
// here, which tells the draw to fade it in (scene/particles.js)
const float RESPAWN_AGE = 10000.0;
`;

// ?bake=0 evaluates the noise wherever it is asked for, as it was before the
// field was baked into textures (scene/crumble.js); for comparison only.
export const BAKE = qp.get('bake') !== '0';

// what the bake pass itself evaluates
export const CYCLE_EXACT = NOISE + CONSTS;

// > 0: this spot rests in the painting. < 0: it has come apart.
export const CYCLE = BAKE ? `
float cycHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
uniform highp sampler2DArray u_crumbleRegions;   // this frame's regions, one layer per panel
uniform highp sampler2DArray u_crumbleGrain;
uniform vec2 u_crumbleSize;                       // painting px the textures span
float surfaceHold(vec2 px, float panel, float sep, float t) {
  vec3 uvw = vec3(px / u_crumbleSize, panel);
  float n = texture(u_crumbleRegions, uvw).r;
  float grain = texture(u_crumbleGrain, uvw).r;
  return n + 0.04 * (grain - 0.5) - (sep * 1.1 - 0.06);
}
${CONSTS}` : `${NOISE}
float surfaceHold(vec2 px, float panel, float sep, float t) {
  return crumbleRegions(px, panel, t) + 0.04 * (crumbleGrain(px, panel) - 0.5) - (sep * 1.1 - 0.06);
}
${CONSTS}`;
