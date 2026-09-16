// The triptych frame: all that is left of the environment. A continuous box
// section following the fold, mitred at the hinges, standing on the floor.
import { gl, uni } from '../gl/context.js';
import { program, depthTwin } from '../gl/program.js';
import { FRAME_VS, FRAME_FS } from '../shaders/frame.glsl.js';
import { IMG_W, IMG_H, FRAME_Z_FRONT, FRAME_Z_BACK, FW } from '../config.js';
import { SQ, txPanel } from './fold.js';
import { bindLight } from './light.js';

const envProg = program(FRAME_VS, FRAME_FS);
const envDepth = depthTwin(FRAME_VS, envProg);

// ---- the triptych frame: all that is left of the environment ----
const envV = [], envI = [];
function rotPanel(n, panel) {
  if (panel === 0) return n;
  const o = txPanel([0, 0, 0], panel);
  const t = txPanel(n, panel);
  return [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
}
function emitFace(pts, n, panel) {
  const base = envV.length / 6;
  const nr = rotPanel(n, panel);
  for (const v of pts) {
    const w = txPanel(v, panel);
    envV.push(w[0], w[1], w[2], nr[0], nr[1], nr[2]);
  }
  if (pts.length === 4) envI.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else envI.push(base, base + 1, base + 2);
}
// a bar whose x-ends may be slanted in z (mitre cuts at the hinges).
// Chamfer applies only to the FRONT edges: the rear stays square so it
// merges flush with the back panel.
function addBarX(x0, m0, x1, m1, y0, y1, z0, z1, panel, ch) {
  const c = ch || 0;
  const X0 = z => x0 + m0 * z, X1 = z => x1 + m1 * z;
  const l0 = Math.hypot(1, m0), l1 = Math.hypot(1, m1);
  const S = Math.SQRT1_2;
  emitFace([[X0(z0),y0+c,z0],[X1(z0),y0+c,z0],[X1(z0),y1-c,z0],[X0(z0),y1-c,z0]], [0,0,-1], panel);
  emitFace([[X0(z1),y0,z1],[X0(z1),y1,z1],[X1(z1),y1,z1],[X1(z1),y0,z1]], [0,0,1], panel);
  emitFace([[X0(z0),y0,z0],[X0(z0),y1,z0],[X0(z1),y1,z1],[X0(z1),y0,z1]], [-1/l0,0,m0/l0], panel);
  emitFace([[X1(z0),y0,z0],[X1(z1),y0,z1],[X1(z1),y1,z1],[X1(z0),y1,z0]], [1/l1,0,-m1/l1], panel);
  emitFace([[X0(z0+c),y0,z0+c],[X0(z1),y0,z1],[X1(z1),y0,z1],[X1(z0+c),y0,z0+c]], [0,-1,0], panel);
  emitFace([[X0(z0+c),y1,z0+c],[X1(z0+c),y1,z0+c],[X1(z1),y1,z1],[X0(z1),y1,z1]], [0,1,0], panel);
  if (c > 0) {
    emitFace([[X0(z0),y0+c,z0],[X1(z0),y0+c,z0],[X1(z0+c),y0,z0+c],[X0(z0+c),y0,z0+c]], [0,-S,-S], panel);
    emitFace([[X0(z0),y1-c,z0],[X0(z0+c),y1,z0+c],[X1(z0+c),y1,z0+c],[X1(z0),y1-c,z0]], [0,S,-S], panel);
  }
}
// continuous frame following the fold, mitred at the hinges, with a deep
// box-section profile; the bottom rail rests on the floor. The rear depth
// fully encloses the resting particle sediment.
const FZ0 = FRAME_Z_FRONT, FZ1 = FRAME_Z_BACK;
const MIT = Math.tan(Math.PI / 8), FC = 4;   // tiny bevel
// center rails (hinge-mitred at both ends)
addBarX(0, -MIT, IMG_W, MIT, -FW, 0, FZ0, FZ1, 0, FC);
addBarX(0, -MIT, IMG_W, MIT, IMG_H, IMG_H + FW, FZ0, FZ1, 0, FC);
// wing rails + upright as ONE mitred corner assembly: 45-degree corner cuts
// make the chamfer strips of rail and upright continue around the corner,
// so the ring reads as a single welded object. Built left, mirrored right.
{
  const A = -IMG_W / 2 - FW, I = -IMG_W / 2, H = IMG_H, c = FC;
  const z0 = FZ0, z1 = FZ1, S = Math.SQRT1_2;
  const X1 = z => MIT * z;
  const l = Math.hypot(1, MIT);
  const FACES = [
    // top rail (outer edge up at -FW); rear faces square, front chamfered
    [[[A+c,-FW+c,z0],[X1(z0),-FW+c,z0],[X1(z0),-c,z0],[I-c,-c,z0]], [0,0,-1]],
    [[[A,-FW,z1],[I,0,z1],[X1(z1),0,z1],[X1(z1),-FW,z1]], [0,0,1]],
    [[[A,-FW,z0+c],[X1(z0+c),-FW,z0+c],[X1(z1),-FW,z1],[A,-FW,z1]], [0,-1,0]],
    [[[I,0,z0+c],[X1(z0+c),0,z0+c],[X1(z1),0,z1],[I,0,z1]], [0,1,0]],
    [[[X1(z0),-FW,z0],[X1(z0),0,z0],[X1(z1),0,z1],[X1(z1),-FW,z1]], [1/l,0,-MIT/l]],
    [[[A+c,-FW+c,z0],[X1(z0),-FW+c,z0],[X1(z0+c),-FW,z0+c],[A,-FW,z0+c]], [0,-S,-S]],
    [[[I-c,-c,z0],[X1(z0),-c,z0],[X1(z0+c),0,z0+c],[I,0,z0+c]], [0,S,-S]],
    // bottom rail (outer edge down at H+FW)
    [[[I-c,H+c,z0],[X1(z0),H+c,z0],[X1(z0),H+FW-c,z0],[A+c,H+FW-c,z0]], [0,0,-1]],
    [[[I,H,z1],[A,H+FW,z1],[X1(z1),H+FW,z1],[X1(z1),H,z1]], [0,0,1]],
    [[[I,H,z0+c],[X1(z0+c),H,z0+c],[X1(z1),H,z1],[I,H,z1]], [0,-1,0]],
    [[[A,H+FW,z0+c],[X1(z0+c),H+FW,z0+c],[X1(z1),H+FW,z1],[A,H+FW,z1]], [0,1,0]],
    [[[X1(z0),H,z0],[X1(z0),H+FW,z0],[X1(z1),H+FW,z1],[X1(z1),H,z1]], [1/l,0,-MIT/l]],
    [[[I-c,H+c,z0],[X1(z0),H+c,z0],[X1(z0+c),H,z0+c],[I,H,z0+c]], [0,-S,-S]],
    [[[A+c,H+FW-c,z0],[X1(z0),H+FW-c,z0],[X1(z0+c),H+FW,z0+c],[A,H+FW,z0+c]], [0,S,-S]],
    // upright, mitred into both rails
    [[[A+c,-FW+c,z0],[I-c,-c,z0],[I-c,H+c,z0],[A+c,H+FW-c,z0]], [0,0,-1]],
    [[[A,-FW,z1],[A,H+FW,z1],[I,H,z1],[I,0,z1]], [0,0,1]],
    [[[A,-FW,z0+c],[A,H+FW,z0+c],[A,H+FW,z1],[A,-FW,z1]], [-1,0,0]],
    [[[I,0,z0+c],[I,H,z0+c],[I,H,z1],[I,0,z1]], [1,0,0]],
    [[[A+c,-FW+c,z0],[A+c,H+FW-c,z0],[A,H+FW,z0+c],[A,-FW,z0+c]], [-S,0,-S]],
    [[[I-c,-c,z0],[I-c,H+c,z0],[I,H,z0+c],[I,0,z0+c]], [S,0,-S]],
  ];
  for (const [pts, n] of FACES) emitFace(pts, n, 1);
  for (const [pts, n] of FACES)
    emitFace(pts.map(p => [IMG_W - p[0], p[1], p[2]]), [-n[0], n[1], n[2]], 2);
}
// back panel, merged square-on into the ring's flat rear
for (const [x0, m0, x1, m1, p] of [
  [-IMG_W / 2 - FW, 0, 0, MIT, 1],
  [0, -MIT, IMG_W, MIT, 0],
  [IMG_W, -MIT, 1.5 * IMG_W + FW, 0, 2],
]) {
  addBarX(x0, m0, x1, m1, -FW, IMG_H + FW, FZ1, FZ1 + 28, p, 0);
}
const frameIdxCount = envI.length;

const envVao = gl.createVertexArray();
gl.bindVertexArray(envVao);
const evb = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, evb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(envV), gl.STATIC_DRAW);
const eib = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eib);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(envI), gl.STATIC_DRAW);
const locEp = gl.getAttribLocation(envProg, 'a_p');
gl.enableVertexAttribArray(locEp);
gl.vertexAttribPointer(locEp, 3, gl.FLOAT, false, 24, 0);
const locEn = gl.getAttribLocation(envProg, 'a_n');
gl.enableVertexAttribArray(locEn);
gl.vertexAttribPointer(locEn, 3, gl.FLOAT, false, 24, 12);
gl.bindVertexArray(null);

// Shaded into an eye, or depth-only into the shadow map.
export function drawFrame(viewProj, cp, depth) {
  const ep = depth ? envDepth : envProg;
  gl.useProgram(ep);
  gl.uniformMatrix4fv(uni(ep, 'u_viewProj'), false, viewProj);
  if (!depth) {
    gl.uniform3f(uni(ep, 'u_camPos'), cp[0], cp[1], cp[2]);
    gl.uniform3f(uni(ep, 'u_col'), 0.22, 0.20, 0.18);
    bindLight(ep);
  }
  gl.bindVertexArray(envVao);
  gl.drawElements(gl.TRIANGLES, frameIdxCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
}
