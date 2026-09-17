// Which pieces can have particles off the painting right now, decided on the
// CPU so the particle passes can skip the rest (scene/particles.js).
//
// A particle only leaves its piece, or shows as a loose grain, where the
// crumble amount is above zero, and that needs Crumble above zero and the piece
// peeled at least halfway (wB > 0.5) or standing on the raised facade. wB comes
// from activation() in shaders/swirl.glsl.js, evaluated here the way
// shaders/xform.glsl.js does it, with two changes that can only widen the set:
// the per-piece jitter is left out (it only ever lowers activation), and a
// margin covers the float difference between GLSL and JavaScript.
//
// Particles that already left still fly home after their piece settles, so a
// piece stays in the set for GRACE seconds after it was last active.
import { PIECES, IMG_W, IMG_H } from '../config.js';
import { RELIEF_RECT } from './relief.js';

// s; at the speed limit a grain crosses the whole triptych (about 3,500 px) in 30
const GRACE = 40;
const MARGIN = 0.01;                       // on activation's inner term

const NP = PIECES.length;
export const N_KEYS = 3 * NP;              // key = piece index + panel * NP, as in the xform pass

// each key's centroid on the unfolded sheet
const sheetX = new Float32Array(N_KEYS), sheetY = new Float32Array(N_KEYS);
const onFacade = new Uint8Array(N_KEYS);
for (let panel = 0; panel < 3; panel++)
  PIECES.forEach((p, pi) => {
    const k = pi + panel * NP;
    sheetX[k] = panel === 0 ? p.c[0] : panel === 1 ? -p.c[0] : 2 * IMG_W - p.c[0];
    sheetY[k] = p.c[1];
    const [rx, ry, rw, rh] = RELIEF_RECT;
    onFacade[k] = sheetX[k] > rx - 1 && sheetX[k] < rx + rw + 1 && sheetY[k] > ry - 1 && sheetY[k] < ry + rh + 1 ? 1 : 0;
  });

// Keys in an order that keeps neighbours on the sheet together (a Hilbert
// curve), so the active pieces, which come in broad patches, form few runs.
function hilbert(x, y, n) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}
export const keyOrder = (() => {
  const G = 1024, d = new Float64Array(N_KEYS);
  for (let k = 0; k < N_KEYS; k++) {
    const gx = Math.min(G - 1, Math.max(0, Math.floor((sheetX[k] + 0.5 * IMG_W) / (2 * IMG_W) * G)));
    const gy = Math.min(G - 1, Math.max(0, Math.floor(sheetY[k] / IMG_H * G)));
    d[k] = hilbert(gx, gy, G);
  }
  return Int32Array.from({ length: N_KEYS }, (_, k) => k).sort((a, b) => d[a] - d[b]);
})();

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lastActive = new Float64Array(N_KEYS).fill(-Infinity);
export const active = new Uint8Array(N_KEYS);

// st is the frame state from ui.js tick()
export function updateActive(st) {
  const TAU = 6.28318;
  const facade = st.form > 0.5 - MARGIN;
  for (let k = 0; k < N_KEYS; k++) {
    let on = false;
    if (st.crumble > 0) {
      if (facade && onFacade[k]) on = true;
      else {
        const px = sheetX[k] / IMG_W * TAU, py = sheetY[k] / IMG_H * TAU, t = st.ftime;
        const n = Math.min(1, Math.max(0, 0.5 + 0.34 * Math.sin(px * 1.9 + t * 0.11) * Math.sin(py * 1.6 - t * 0.09)
                                              + 0.16 * Math.sin(px * 3.4 + py * 2.9 - t * 0.07)));
        const act = smooth(0, 0.85, st.sep * 1.9 - n * 0.95 + MARGIN);
        on = smooth(0.5, 1, act) > 0.5;
      }
    }
    if (on) lastActive[k] = st.t;
    active[k] = st.t - lastActive[k] < GRACE ? 1 : 0;
  }
}
