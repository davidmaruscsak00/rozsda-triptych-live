// The Judit bust as a facade: its front half, cut at the bust's middle plane,
// merged into the centre panel as a relief. Built at load from the sampled
// surface (assets/judit-surface.bin, scripts/sample_mesh.py) into a height map:
// how far the face stands out of the painting, in painting px. The head's sides
// meet the cut plane at zero height, so the relief merges into the painting
// without a seam; the shoulders' flat cut fades out toward the bottom. The Form
// slider raises it.
import { gl, uni } from '../gl/context.js';
import { IMG_W, IMG_H } from '../config.js';

const RES = 256;
const BUST_H = 0.85 * IMG_H;                      // the bust is as wide as it is tall
export const RELIEF_RECT = [0.5 * IMG_W - 0.5 * BUST_H, 0.05 * IMG_H, BUST_H, BUST_H];

const raw = new Float32Array(await (await fetch('../assets/judit-surface.bin')).arrayBuffer());

// splat the front half: the height at a cell is its most forward point
let h = new Float32Array(RES * RES).fill(-1);
for (let i = 0; i < raw.length; i += 6) {
  const z = raw[i + 2];                           // toward the viewer is negative
  if (z > 0) continue;
  const cx = Math.floor((raw[i] + 0.5) * RES), cy = Math.floor((raw[i + 1] + 0.5) * RES);
  if (cx < 0 || cy < 0 || cx >= RES || cy >= RES) continue;
  const k = cy * RES + cx;
  h[k] = Math.max(h[k], -z);
}
// close the sampling holes inside the silhouette without bleeding outside it:
// a cell fills only when most of its neighbours are filled
for (let pass = 0; pass < 6; pass++) {
  const next = h.slice();
  for (let y = 1; y < RES - 1; y++) for (let x = 1; x < RES - 1; x++) {
    const k = y * RES + x;
    if (h[k] >= 0) continue;
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = h[k + dy * RES + dx];
      if (v >= 0) { sum += v; n++; }
    }
    if (n >= 4) next[k] = sum / n;
  }
  h = next;
}
// empty cells are the painting itself; soften the sampling grain; fade the
// shoulders' flat cut at the bottom and the sides
const soft = new Float32Array(RES * RES);
for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
  let sum = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= RES || yy >= RES) continue;
    sum += Math.max(h[yy * RES + xx], 0); n++;
  }
  const u = x / (RES - 1), v = y / (RES - 1);
  const ss = (a, b, t) => { const q = Math.min(1, Math.max(0, (t - a) / (b - a))); return q * q * (3 - 2 * q); };
  const fade = (1 - ss(0.86, 1.0, v)) * ss(0.0, 0.08, u) * (1 - ss(0.92, 1.0, u));
  soft[y * RES + x] = sum / n * BUST_H * fade;
}

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, RES, RES);
gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RES, RES, gl.RED, gl.FLOAT, soft);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.bindTexture(gl.TEXTURE_2D, null);

// For a program that includes RELIEF (shaders/relief.glsl.js); unit 8.
export function bindRelief(p, form) {
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(uni(p, 'u_relief'), 8);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform4f(uni(p, 'u_reliefRect'), ...RELIEF_RECT);
  gl.uniform1f(uni(p, 'u_form'), form);
}
