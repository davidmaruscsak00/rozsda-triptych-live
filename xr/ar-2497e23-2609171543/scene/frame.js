// The frame: a thin metal edge around the triptych, following the fold, mitred
// at the hinges and the wing tips, standing on the floor. No box and no back
// panel, so wherever the painting has come apart the room shows through.
import { gl, uni } from '../gl/context.js';
import { program, depthTwin } from '../gl/program.js';
import { FRAME_VS, FRAME_FS } from '../shaders/frame.glsl.js';
import { IMG_W, IMG_H, EDGE_W, EDGE_Z0, EDGE_Z1 } from '../config.js';
import { txPanel } from './fold.js';
import { bindLight } from './light.js';

const envProg = program(FRAME_VS, FRAME_FS);
const envDepth = depthTwin(FRAME_VS, envProg);

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
  envI.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
// a bar along x whose ends may be slanted in z (mitre cuts at the hinges), with
// a small bevel on its front edges so they catch the light
function addBarX(x0, m0, x1, m1, y0, y1, z0, z1, panel, c) {
  const X0 = z => x0 + m0 * z, X1 = z => x1 + m1 * z;
  const l0 = Math.hypot(1, m0), l1 = Math.hypot(1, m1);
  const S = Math.SQRT1_2;
  emitFace([[X0(z0),y0+c,z0],[X1(z0),y0+c,z0],[X1(z0),y1-c,z0],[X0(z0),y1-c,z0]], [0,0,-1], panel);
  emitFace([[X0(z1),y0,z1],[X0(z1),y1,z1],[X1(z1),y1,z1],[X1(z1),y0,z1]], [0,0,1], panel);
  emitFace([[X0(z0),y0,z0],[X0(z0),y1,z0],[X0(z1),y1,z1],[X0(z1),y0,z1]], [-1/l0,0,m0/l0], panel);
  emitFace([[X1(z0),y0,z0],[X1(z1),y0,z1],[X1(z1),y1,z1],[X1(z0),y1,z0]], [1/l1,0,-m1/l1], panel);
  emitFace([[X0(z0+c),y0,z0+c],[X0(z1),y0,z1],[X1(z1),y0,z1],[X1(z0+c),y0,z0+c]], [0,-1,0], panel);
  emitFace([[X0(z0+c),y1,z0+c],[X1(z0+c),y1,z0+c],[X1(z1),y1,z1],[X0(z1),y1,z1]], [0,1,0], panel);
  emitFace([[X0(z0),y0+c,z0],[X1(z0),y0+c,z0],[X1(z0+c),y0,z0+c],[X0(z0+c),y0,z0+c]], [0,-S,-S], panel);
  emitFace([[X0(z0),y1-c,z0],[X0(z0+c),y1,z0+c],[X1(z0+c),y1,z0+c],[X1(z0),y1-c,z0]], [0,S,-S], panel);
}
// a vertical bar at a wing tip, in its wing's unfolded frame
function addBarY(x0, x1, y0, y1, z0, z1, panel, c) {
  const S = Math.SQRT1_2;
  emitFace([[x0+c,y0,z0],[x0+c,y1,z0],[x1-c,y1,z0],[x1-c,y0,z0]], [0,0,-1], panel);
  emitFace([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], [0,0,1], panel);
  emitFace([[x0,y0,z0+c],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0+c]], [-1,0,0], panel);
  emitFace([[x1,y0,z0+c],[x1,y1,z0+c],[x1,y1,z1],[x1,y0,z1]], [1,0,0], panel);
  emitFace([[x0+c,y0,z0],[x0,y0,z0+c],[x0,y1,z0+c],[x0+c,y1,z0]], [-S,0,-S], panel);
  emitFace([[x1-c,y0,z0],[x1-c,y1,z0],[x1,y1,z0+c],[x1,y0,z0+c]], [S,0,-S], panel);
}

const E = EDGE_W, H = IMG_H, W = IMG_W, BEVEL = 1.5;
const MIT = Math.tan(Math.PI / 8);            // half the 45-degree hinge
// centre panel rails, mitred at both hinges
addBarX(0, -MIT, W, MIT, -E, 0, EDGE_Z0, EDGE_Z1, 0, BEVEL);
addBarX(0, -MIT, W, MIT, H, H + E, EDGE_Z0, EDGE_Z1, 0, BEVEL);
// wing rails, mitred at the hinge, running to the outside of the tip upright
addBarX(-W / 2 - E, 0, 0, MIT, -E, 0, EDGE_Z0, EDGE_Z1, 1, BEVEL);
addBarX(-W / 2 - E, 0, 0, MIT, H, H + E, EDGE_Z0, EDGE_Z1, 1, BEVEL);
addBarY(-W / 2 - E, -W / 2, 0, H, EDGE_Z0, EDGE_Z1, 1, BEVEL);
// the right wing is the left one mirrored: x runs from the hinge outward
addBarX(W, -MIT, 1.5 * W + E, 0, -E, 0, EDGE_Z0, EDGE_Z1, 2, BEVEL);
addBarX(W, -MIT, 1.5 * W + E, 0, H, H + E, EDGE_Z0, EDGE_Z1, 2, BEVEL);
addBarY(1.5 * W, 1.5 * W + E, 0, H, EDGE_Z0, EDGE_Z1, 2, BEVEL);
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
    gl.uniform3f(uni(ep, 'u_col'), 0.80, 0.64, 0.36);      // aged brass
    bindLight(ep);
  }
  gl.bindVertexArray(envVao);
  gl.drawElements(gl.TRIANGLES, frameIdxCount, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
}
