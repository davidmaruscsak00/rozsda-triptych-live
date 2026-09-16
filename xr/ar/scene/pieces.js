// The painting's own pieces: every detected shape, extruded, drawn once per
// triptych panel. They move by the xform pass and crumble into particles.
import { gl, uni } from '../gl/context.js';
import { program, depthTwin } from '../gl/program.js';
import { PIECES_VS, PIECES_FS, PIECES_DEPTH_FS } from '../shaders/pieces.glsl.js';
import { PIECES, IMG_W, IMG_H } from '../config.js';
import { NP, pieceThickness, bindXform } from './xform.js';
import { bindLight } from './light.js';

const pcProg = program(PIECES_VS, PIECES_FS);
const pcDepth = depthTwin(PIECES_VS, pcProg, PIECES_DEPTH_FS);

// ---- extruded piece mesh (front cap, back cap, side walls) ----
let nVerts = 0, nIdx = 0;
for (const p of PIECES) {
  const n = p.v.length / 2;
  nVerts += 6 * n;
  nIdx += 2 * p.t.length + 6 * n;
}
const F = 10;
const vdata = new Float32Array(nVerts * F);
const idata = new Uint32Array(nIdx);
let vo = 0, io = 0;

PIECES.forEach((p, pi) => {
  const n = p.v.length / 2;
  const T = pieceThickness(p);
  const cx = p.c[0], cy = p.c[1], cz = T * 0.5, seed = pi + 1;
  const base = vo / F;

  function push(x, y, z, nx, ny, nz) {
    vdata.set([x, y, z, nx, ny, nz, cx, cy, cz, seed], vo);
    vo += F;
  }
  for (let i = 0; i < n; i++) push(p.v[2*i], p.v[2*i+1], 0, 0, 0, -1);
  for (let i = 0; i < n; i++) push(p.v[2*i], p.v[2*i+1], T, 0, 0,  1);
  for (let i = 0; i < p.t.length; i += 3) {
    const a = p.t[i], b = p.t[i+1], c = p.t[i+2];
    idata[io++] = base + a; idata[io++] = base + b; idata[io++] = base + c;
    idata[io++] = base + n + a; idata[io++] = base + n + c; idata[io++] = base + n + b;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = p.v[2*i], y0 = p.v[2*i+1], x1 = p.v[2*j], y1 = p.v[2*j+1];
    let nx = y1 - y0, ny = -(x1 - x0);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const s = vo / F;
    push(x0, y0, 0, nx, ny, 0); push(x1, y1, 0, nx, ny, 0);
    push(x1, y1, T, nx, ny, 0); push(x0, y0, T, nx, ny, 0);
    idata[io++] = s; idata[io++] = s + 1; idata[io++] = s + 2;
    idata[io++] = s; idata[io++] = s + 2; idata[io++] = s + 3;
  }
});

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, vdata, gl.STATIC_DRAW);
const ibo = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idata, gl.STATIC_DRAW);
const stride = F * 4;
const attr = (name, size, off) => {
  const loc = gl.getAttribLocation(pcProg, name);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
};
attr('a_pos', 3, 0);
attr('a_norm', 3, 3);
attr('a_cen', 4, 6);
gl.bindVertexArray(null);

// Shaded into an eye, or depth-only into the shadow map.
export function drawPieces(viewProj, cp, st, depth) {
  const pp = depth ? pcDepth : pcProg;
  gl.useProgram(pp);
  gl.uniform1i(uni(pp, 'u_paint'), 0);
  gl.uniform2f(uni(pp, 'u_imgSize'), IMG_W, IMG_H);
  gl.uniform1f(uni(pp, 'u_crumble'), st.crumble);
  gl.uniform1f(uni(pp, 'u_ctime'), st.ctime);
  gl.uniform1f(uni(pp, 'u_np'), NP);
  bindXform(pp);
  if (!depth) {
    gl.uniform3f(uni(pp, 'u_camPos'), cp[0], cp[1], cp[2]);
    bindLight(pp);
  }
  gl.uniformMatrix4fv(uni(pp, 'u_viewProj'), false, viewProj);
  gl.bindVertexArray(vao);
  for (let p = 0; p < 3; p++) {
    gl.uniform1i(uni(pp, 'u_panel'), p);
    gl.drawElements(gl.TRIANGLES, idata.length, gl.UNSIGNED_INT, 0);
  }
  gl.bindVertexArray(null);
}
