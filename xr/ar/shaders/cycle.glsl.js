// Which parts of the painting are apart right now. One slowly drifting noise
// field over the painting, shared by the pieces (erosion), the particles
// (release and return) and the canvas behind them (cover), so all three agree
// to the pixel. Regions come apart and grow back on their own; the slider sets
// how much of the painting is apart on average.
//
// panel is 0 centre, 1 left wing, 2 right wing, so the mirrored wings do not
// echo the centre. px is the original painting pixel.
export const CYCLE = `
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

// > 0: this spot rests in the painting. < 0: it has come apart. Broad drifting
// regions, a finer fraying edge, and a static grain so the edge crumbles.
float surfaceHold(vec2 px, float panel, float sep, float t) {
  vec2 q = (px + vec2(1733.0, 977.0) * panel) / 430.0;
  float n = 0.60 * cycNoise3(vec3(q, t * 0.030))
          + 0.28 * cycNoise3(vec3(q * 2.7 + 5.2, t * 0.055))
          + 0.12 * cycNoise3(vec3(q * 8.3 + 1.7, t * 0.090));
  n = clamp((n - 0.5) * 2.1 + 0.5, 0.0, 1.0);             // spread to roughly even coverage
  float grain = cycNoise3(vec3(px / 3.2, panel * 7.0));
  return n + 0.04 * (grain - 0.5) - (sep * 1.1 - 0.06);
}

// Crumbling is gradual. Below 0 a spot is coming apart; each grain leaves once
// the hold is below -RELEASE_SPAN * sqrt(its own random), so the share that
// has left grows with the square of the depth: a few grains first, then more.
// The solid surface only goes at -SURFACE_AT, when about three quarters of its
// grains are out; the last ones sit on as loose grains before they drift off.
const float RELEASE_SPAN = 0.30;
const float SURFACE_AT = 0.26;
`;
