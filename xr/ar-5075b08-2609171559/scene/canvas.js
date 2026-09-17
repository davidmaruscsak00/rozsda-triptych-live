// The painting as one flat surface behind the pieces, one quad per panel.
// While the painting rests it hides the cracks between pieces and the chips
// behind them, and it gives the edges a straight line. It opens wherever the
// swell has begun, so it never shows once the pieces move.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { CANVAS_VS, CANVAS_FS } from '../shaders/canvas.glsl.js';
import { txPanel } from './fold.js';
import { bindLight } from './light.js';
import { bindRelief } from './relief.js';
import { IMG_W, IMG_H } from '../config.js';

// Pieces' front faces sit at z=0 and are at least 5 px thick, so 2 px back is
// inside every piece: covered where a piece is, visible only through gaps.
const Z = 2;

const prog = program(CANVAS_VS, CANVAS_FS);

// one grid per panel; the centre is fine enough to follow the Judit facade
const verts = [], idx = [];
for (const [x0, x1, panel, gx, gy] of [[-IMG_W / 2, 0, 1, 1, 1], [0, IMG_W, 0, 200, 160],
                                       [IMG_W, 1.5 * IMG_W, 2, 1, 1]]) {
  const base = verts.length / 8;
  const o = txPanel([0, 0, 0], panel), f = txPanel([0, 0, -1], panel);
  const n = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];
  for (let j = 0; j <= gy; j++) for (let i = 0; i <= gx; i++) {
    const x = x0 + (x1 - x0) * i / gx, y = IMG_H * j / gy;
    verts.push(...txPanel([x, y, Z], panel), ...n, x, y);
  }
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const k = base + j * (gx + 1) + i;
    idx.push(k, k + 1, k + gx + 2, k, k + gx + 2, k + gx + 1);
  }
}

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
[['a_pos', 3, 0], ['a_norm', 3, 12], ['a_sheet', 2, 24]].forEach(([name, size, off]) => {
  const loc = gl.getAttribLocation(prog, name);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off);
});
gl.bindVertexArray(null);

// Shaded only: the pieces in front already cast this surface's shadow.
export function drawCanvas(viewProj, cp, st) {
  gl.useProgram(prog);
  gl.uniformMatrix4fv(uni(prog, 'u_viewProj'), false, viewProj);
  gl.uniform1i(uni(prog, 'u_paint'), 0);
  gl.uniform2f(uni(prog, 'u_imgSize'), IMG_W, IMG_H);
  gl.uniform1f(uni(prog, 'u_sep'), st.sep);
  gl.uniform1f(uni(prog, 'u_ftime'), st.ftime);
  gl.uniform2f(uni(prog, 'u_imgSize'), IMG_W, IMG_H);
  bindRelief(prog, st.form);
  gl.uniform3f(uni(prog, 'u_camPos'), cp[0], cp[1], cp[2]);
  bindLight(prog);
  gl.bindVertexArray(vao);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
}
