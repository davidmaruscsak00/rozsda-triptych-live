// Piece transforms, once per frame: every piece in every panel, one texel each,
// in three float textures. See shaders/xform.glsl.js.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { XFORM_VS, XFORM_FS } from '../shaders/xform.glsl.js';
import { PIECES, IMG_W, IMG_H, FRAME_Z_FRONT, FRAME_Z_BACK } from '../config.js';
import { bindRelief } from './relief.js';

if (!gl.getExtension('EXT_color_buffer_float'))
  throw new Error('EXT_color_buffer_float is required for the piece transform pass');

export const NP = PIECES.length;                 // pieces per panel
export const XF_SIDE = Math.ceil(Math.sqrt(3 * NP));

// the extrusion depth of a piece, shared with its mesh
export const pieceThickness = p => Math.min(16, Math.max(5, 0.22 * Math.sqrt(p.a)));

const prog = program(XFORM_VS, XFORM_FS);

// one point per (panel, piece), in texel order
const data = new Float32Array(3 * NP * 4);
for (let panel = 0; panel < 3; panel++)
  PIECES.forEach((p, pi) => data.set([p.c[0], p.c[1], pieceThickness(p) * 0.5, pi + 1], (panel * NP + pi) * 4));
const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a_cen');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

const textures = [0, 1, 2].map(() => {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, XF_SIDE, XF_SIDE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
});
gl.bindTexture(gl.TEXTURE_2D, null);
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

export function runXform(st) {
  gpuBegin('xform');
  for (let i = 0; i < 3; i++) {                  // never sampled while being written
    gl.activeTexture(gl.TEXTURE3 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, XF_SIDE, XF_SIDE);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  gl.uniform2f(uni(prog, 'u_imgSize'), IMG_W, IMG_H);
  gl.uniform1f(uni(prog, 'u_sep'), st.sep);
  gl.uniform1f(uni(prog, 'u_ftime'), st.ftime);
  gl.uniform1f(uni(prog, 'u_drift'), st.drift);
  gl.uniform1f(uni(prog, 'u_boxFront'), FRAME_Z_FRONT);
  gl.uniform1f(uni(prog, 'u_boxBack'), FRAME_Z_BACK);
  gl.uniform1f(uni(prog, 'u_side'), XF_SIDE);
  gl.uniform1f(uni(prog, 'u_np'), NP);
  bindRelief(prog, st.form);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.POINTS, 0, 3 * NP);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gpuEnd();
}

// Binds the transforms to units 3-5 for a program that includes XFORM_READ.
export function bindXform(p) {
  textures.forEach((t, i) => {
    gl.activeTexture(gl.TEXTURE3 + i);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uni(p, 'u_xf' + i), 3 + i);
  });
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(uni(p, 'u_xfSide'), XF_SIDE);
}
