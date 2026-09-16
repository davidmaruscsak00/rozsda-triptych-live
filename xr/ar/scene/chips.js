// The hallucination: ~324k chips cut from the painting's own piece shapes.
// A transform-feedback field pass computes one record per chip per frame;
// the draw instances template prisms onto those records.
import { gl, uni } from '../gl/context.js';
import { program, programTF, depthTwin, DEPTH_FS } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { FIELD_VS } from '../shaders/field.glsl.js';
import { CHIPS_VS, CHIPS_FS } from '../shaders/chips.glsl.js';
import { paintTex } from './paint.js';
import { PIECES, IMG_W, IMG_H, N_MAIN, N_WEDGE, N_PARTICLES,
         FRAME_Z_FRONT, FRAME_Z_BACK, SHADOW_FRAC, SHOW_CHIPS } from '../config.js';

const blProg = program(CHIPS_VS, CHIPS_FS);
const blDepth = depthTwin(CHIPS_VS, blProg);
const tfProg = programTF(FIELD_VS, DEPTH_FS, ['o_A', 'o_B', 'o_C', 'o_D']);

// ---- particle shape templates: small irregular prisms taken straight from
// the painting's detected pieces (centered on centroid, unit-normalized) ----
const cubeV = [], cubeI = [];
const TPL_RANGES = [];
{
  const cands = PIECES.filter(p => {
    const n = p.v.length / 2;
    return n >= 5 && n <= 14;
  });
  const step = Math.max(1, Math.floor(cands.length / 64));
  for (let ti = 0; ti < cands.length && TPL_RANGES.length < 64; ti += step) {
    const p = cands[ti];
    const n = p.v.length / 2;
    const s = 1 / Math.sqrt(p.a);
    const lx = [], ly = [];
    for (let i = 0; i < n; i++) {
      lx.push((p.v[2*i] - p.c[0]) * s);
      ly.push((p.v[2*i+1] - p.c[1]) * s);
    }
    const base = cubeV.length / 6;
    const idxStart = cubeI.length;
    for (let i = 0; i < n; i++) cubeV.push(lx[i], ly[i], -0.5, 0, 0, -1);  // front
    for (let i = 0; i < n; i++) cubeV.push(lx[i], ly[i],  0.5, 0, 0,  1);  // back
    for (let i = 0; i < p.t.length; i += 3) {
      const a = p.t[i], b = p.t[i+1], c = p.t[i+2];
      cubeI.push(base + a, base + b, base + c);
      cubeI.push(base + n + a, base + n + c, base + n + b);
    }
    for (let i = 0; i < n; i++) {                                          // sides
      const j = (i + 1) % n;
      let nx = ly[j] - ly[i], ny = -(lx[j] - lx[i]);
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      const sBase = cubeV.length / 6;
      cubeV.push(lx[i], ly[i], -0.5, nx, ny, 0);
      cubeV.push(lx[j], ly[j], -0.5, nx, ny, 0);
      cubeV.push(lx[j], ly[j],  0.5, nx, ny, 0);
      cubeV.push(lx[i], ly[i],  0.5, nx, ny, 0);
      cubeI.push(sBase, sBase + 1, sBase + 2, sBase, sBase + 2, sBase + 3);
    }
    TPL_RANGES.push({ off: idxStart, cnt: cubeI.length - idxStart });
  }
}

const cvb = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, cvb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeV), gl.STATIC_DRAW);
const cib = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cib);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cubeI), gl.STATIC_DRAW);

// ---- per-instance chip records ------------------------------------------
// One 64-byte record per chip, written once per frame by the field pass and
// read as instanced attributes by every eye. index.html had no per-instance
// attributes at all (vertexAttribDivisor was never called): each chip
// re-derived itself from gl_InstanceID on every one of its ~53 vertices.
const perTpl = Math.ceil(N_PARTICLES / TPL_RANGES.length);
const TF_STRIDE = 64;                        // 4 x vec4
const tfCount = TPL_RANGES.length * perTpl;  // seeds run 0..tfCount-1
const tfBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf);
gl.bufferData(gl.ARRAY_BUFFER, tfCount * TF_STRIDE, gl.DYNAMIC_COPY);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const tfVao = gl.createVertexArray();        // attribute-less: gl_VertexID only

// A VAO per template, each pointing at its own slice of the record buffer, so
// a batch costs one bindVertexArray instead of re-pointing four attributes,
// per batch per eye.
const blVaos = TPL_RANGES.map((r, ti) => {
  const v = gl.createVertexArray();
  gl.bindVertexArray(v);
  gl.bindBuffer(gl.ARRAY_BUFFER, cvb);
  const locCv = gl.getAttribLocation(blProg, 'a_cv');
  gl.enableVertexAttribArray(locCv);
  gl.vertexAttribPointer(locCv, 3, gl.FLOAT, false, 24, 0);
  const locCn = gl.getAttribLocation(blProg, 'a_cn');
  gl.enableVertexAttribArray(locCn);
  gl.vertexAttribPointer(locCn, 3, gl.FLOAT, false, 24, 12);
  gl.bindBuffer(gl.ARRAY_BUFFER, tfBuf);
  const base = ti * perTpl * TF_STRIDE;
  ['a_A', 'a_B', 'a_C', 'a_D'].forEach((nm, k) => {
    const loc = gl.getAttribLocation(blProg, nm);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, TF_STRIDE, base + k * 16);
    gl.vertexAttribDivisor(loc, 1);
  });
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cib);
  gl.bindVertexArray(null);
  return v;
});

// ---- the field pass ----------------------------------------------------
// Everything that varies per chip but not per vertex: hashes, activation,
// wave/box/curl sampling, the velocity finite-difference, the collision
// clamp, the orientation basis, the panel fold and the paint texture fetch.
// Runs once per frame for the whole field: not once per eye, not per vertex.
export function runFieldPass(st) {
  if (!SHOW_CHIPS) return;
  gpuBegin('field');
  gl.useProgram(tfProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, paintTex);
  gl.uniform1i(uni(tfProg, 'u_paint'), 0);
  gl.uniform2f(uni(tfProg, 'u_imgSize'), IMG_W, IMG_H);
  gl.uniform1f(uni(tfProg, 'u_sep'), st.sep);
  gl.uniform1f(uni(tfProg, 'u_ftime'), st.ftime);
  gl.uniform1f(uni(tfProg, 'u_drift'), st.drift);
  gl.uniform1f(uni(tfProg, 'u_nMain'), N_MAIN);
  gl.uniform1f(uni(tfProg, 'u_nWedgeHalf'), N_WEDGE / 2);
  gl.uniform1f(uni(tfProg, 'u_boxFront'), FRAME_Z_FRONT);
  gl.uniform1f(uni(tfProg, 'u_boxBack'), FRAME_Z_BACK);
  gl.bindVertexArray(tfVao);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfBuf);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, tfCount);
  gl.endTransformFeedback();
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindVertexArray(null);
  gpuEnd();
}

// Shaded into an eye, or depth-only into the shadow map. The bar field is
// hidden behind intact pieces and revealed as they leave. Seeds within a
// template's slice are hashed independently, so the first fraction of every
// slice is an unbiased thinning of the whole field.
export function drawChips(viewProj, cp, depth) {
  if (!SHOW_CHIPS) return;
  const bp = depth ? blDepth : blProg;
  const inst = depth ? Math.ceil(perTpl * SHADOW_FRAC) : perTpl;
  if (!depth) gpuBegin('draw');
  gl.useProgram(bp);
  gl.uniform3f(uni(bp, 'u_camPos'), cp[0], cp[1], cp[2]);
  gl.uniformMatrix4fv(uni(bp, 'u_viewProj'), false, viewProj);
  gl.uniform1f(uni(bp, 'u_dimScale'), depth ? 1 / Math.sqrt(Math.max(SHADOW_FRAC, 1e-3)) : 1);
  if (inst > 0) TPL_RANGES.forEach((r, ti) => {
    gl.bindVertexArray(blVaos[ti]);
    gl.drawElementsInstanced(gl.TRIANGLES, r.cnt, gl.UNSIGNED_SHORT, r.off * 2, inst);
  });
  gl.bindVertexArray(null);
  if (!depth) gpuEnd();
}
