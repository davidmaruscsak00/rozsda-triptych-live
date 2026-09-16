// The pieces as particles. Each particle is a point on one piece in one panel,
// stored in that piece's own frame, so it rides along wherever the piece flies.
// Each frame one transform-feedback step moves every particle: sitting on its
// piece, released where a broken-off piece crumbles, pulled back onto the
// piece where it grows back. State lives in two buffers that swap every frame.
import { gl, uni } from '../gl/context.js';
import { program, programTF, DEPTH_FS } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { SIM_VS, PARTICLES_VS, PARTICLES_FS } from '../shaders/particles.glsl.js';
import { NP, pieceThickness, bindXform } from './xform.js';
import { bindFluid } from './fluid.js';
import { bindLight } from './light.js';
import { bindRelief } from './relief.js';
import { PIECES, IMG_W, IMG_H, N_POINTS, SHADOW_FRAC, FLOOR_Y, FRAME_Z_FRONT, FRAME_Z_BACK, FW } from '../config.js';

const simProg = programTF(SIM_VS, DEPTH_FS, ['o_s0', 'o_s1']);
const drawProg = program(PARTICLES_VS, PARTICLES_FS);

// deterministic, so the same particles come back on every load
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eed);

// Scattered over every piece's triangles in proportion to area, N_POINTS per
// painting; a piece near the middle also appears mirrored in a wing, with its
// own particles there. Random order (the shadow pass draws a prefix).
const W = IMG_W, H = IMG_H;
const density = N_POINTS / (W * H);

// Millions of particles, so no intermediate JS arrays: first decide how many
// land on each triangle, then write records straight into one typed array.
const tris = [];                                // [piece, triangle offset, count]
let count = 0;
PIECES.forEach((p, pi) => {
  const nPanels = 1 + (p.c[0] <= 0.5 * W + 60) + (p.c[0] >= 0.5 * W - 60);
  for (let i = 0; i < p.t.length; i += 3) {
    const ax = p.v[2 * p.t[i]], ay = p.v[2 * p.t[i] + 1];
    const bx = p.v[2 * p.t[i + 1]], by = p.v[2 * p.t[i + 1] + 1];
    const qx = p.v[2 * p.t[i + 2]], qy = p.v[2 * p.t[i + 2] + 1];
    const want = Math.abs((bx - ax) * (qy - ay) - (qx - ax) * (by - ay)) / 2 * density;
    const n = Math.floor(want) + (rand() < want % 1 ? 1 : 0);
    if (n) { tris.push(pi, i, n); count += n * nPanels; }
  }
});
const statics = new Float32Array(count * 8);    // local.xyz, piece index, src.xy, r1, r2
{
  let o = 0;
  for (let k = 0; k < tris.length; k += 3) {
    const pi = tris[k], i = tris[k + 1], n = tris[k + 2], p = PIECES[pi];
    const cx = p.c[0], cy = p.c[1], front = -pieceThickness(p) * 0.5 - 1.5;
    const ax = p.v[2 * p.t[i]], ay = p.v[2 * p.t[i] + 1];
    const bx = p.v[2 * p.t[i + 1]], by = p.v[2 * p.t[i + 1] + 1];
    const qx = p.v[2 * p.t[i + 2]], qy = p.v[2 * p.t[i + 2] + 1];
    const left = cx <= 0.5 * W + 60, right = cx >= 0.5 * W - 60;
    for (let j = 0; j < n; j++) {
      let u = rand(), v = rand();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const x = ax + u * (bx - ax) + v * (qx - ax), y = ay + u * (by - ay) + v * (qy - ay);
      const r1 = rand(), r2 = rand();
      for (let panel = 0; panel < 3; panel++) {  // wings are mirrored in x
        if ((panel === 1 && !left) || (panel === 2 && !right)) continue;
        statics[o++] = panel ? cx - x : x - cx; statics[o++] = y - cy; statics[o++] = front;
        statics[o++] = pi + panel * NP; statics[o++] = x; statics[o++] = y;
        statics[o++] = r1; statics[o++] = r2;
      }
    }
  }
}
// shuffle the records in place, so any prefix is an unbiased thinning
for (let i = count - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  for (let k = 0; k < 8; k++) {
    const t = statics[i * 8 + k]; statics[i * 8 + k] = statics[j * 8 + k]; statics[j * 8 + k] = t;
  }
}
const state = new Float32Array(count * 8);      // pos.xyz, age, vel.xyz, hold
for (let i = 0; i < count; i++) state[i * 8 + 7] = 1;

const staticBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
gl.bufferData(gl.ARRAY_BUFFER, statics, gl.STATIC_DRAW);
const stateBufs = [0, 1].map(() => {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, state, gl.DYNAMIC_COPY);
  return b;
});
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// one VAO per state buffer; both programs use the same fixed locations 0..3
const vaos = stateBufs.map(sb => {
  const v = gl.createVertexArray();
  gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, sb);
  [[0, 0], [1, 16]].forEach(([loc, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off);
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
  [[2, 0], [3, 16]].forEach(([loc, off]) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off);
  });
  gl.bindVertexArray(null);
  return v;
});
let cur = 0;                                   // index of the buffer holding the latest state

export const particleCount = count;

// Once per frame, before any drawing.
export function updateParticles(st) {
  gpuBegin('field');
  gl.useProgram(simProg);
  gl.uniform2f(uni(simProg, 'u_imgSize'), W, H);
  gl.uniform1f(uni(simProg, 'u_time'), st.t);
  gl.uniform1f(uni(simProg, 'u_dt'), st.dtr);
  gl.uniform1f(uni(simProg, 'u_drift'), st.drift);
  gl.uniform1f(uni(simProg, 'u_floorY'), FLOOR_Y);
  gl.uniform1f(uni(simProg, 'u_np'), NP);
  gl.uniform1f(uni(simProg, 'u_crumble'), st.crumble);
  gl.uniform1f(uni(simProg, 'u_ctime'), st.ctime);
  gl.uniform1f(uni(simProg, 'u_swirl'), st.swirl);
  gl.uniform1f(uni(simProg, 'u_frameFront'), FRAME_Z_FRONT);
  gl.uniform1f(uni(simProg, 'u_frameBack'), FRAME_Z_BACK + 28);
  gl.uniform1f(uni(simProg, 'u_frameW'), FW);
  gl.uniform1f(uni(simProg, 'u_gravity'), st.gravity);
  bindFluid(simProg);
  bindRelief(simProg, st.form);
  bindXform(simProg);
  gl.bindVertexArray(vaos[cur]);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, stateBufs[1 - cur]);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, count);
  gl.endTransformFeedback();
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindVertexArray(null);
  cur = 1 - cur;
  gpuEnd();
}

// Shaded into an eye (soft dots through alpha-to-coverage), or into the shadow
// map as a thinned, enlarged subset. vpH is the target's height in px.
export function drawParticles(viewProj, cp, st, depth, vpH) {
  const n = depth ? Math.ceil(count * SHADOW_FRAC) : count;
  if (n === 0) return;
  if (!depth) gpuBegin('draw');
  gl.useProgram(drawProg);
  gl.uniformMatrix4fv(uni(drawProg, 'u_viewProj'), false, viewProj);
  gl.uniform1i(uni(drawProg, 'u_paint'), 0);
  gl.uniform2f(uni(drawProg, 'u_imgSize'), W, H);
  gl.uniform1f(uni(drawProg, 'u_vpH'), vpH);
  gl.uniform1f(uni(drawProg, 'u_sizeScale'), depth ? 1 / Math.sqrt(Math.max(SHADOW_FRAC, 1e-3)) : 1);
  gl.uniform1f(uni(drawProg, 'u_lit'), depth ? 0 : 1);
  gl.uniform3f(uni(drawProg, 'u_camPos'), cp[0], cp[1], cp[2]);
  bindLight(drawProg);
  if (!depth) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  gl.bindVertexArray(vaos[cur]);
  gl.drawArrays(gl.POINTS, 0, n);
  gl.bindVertexArray(null);
  if (!depth) { gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gpuEnd(); }
}
