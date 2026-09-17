// The water: a stable-fluids solver on a grid over the unfolded triptych sheet,
// stepped once per frame. The particle simulation samples its velocity.
// See shaders/fluid.glsl.js.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { FLUID_VS, ADVECT_FS, FORCE_FS, CURL_FS, VORTICITY_FS, DIVERGENCE_FS,
         JACOBI_FS, PROJECT_FS } from '../shaders/fluid.glsl.js';
import { IMG_W, IMG_H } from '../config.js';

// the sheet from wing tip to wing tip, with a margin, at roughly 13 px a cell
const PAD = 100;
export const FLUID_ORIGIN = [-0.5 * IMG_W - PAD, -PAD];
export const FLUID_SIZE = [2 * IMG_W + 2 * PAD, IMG_H + 2 * PAD];
const GX = 256, GY = Math.round(GX * FLUID_SIZE[1] / FLUID_SIZE[0]);
const CELL = [FLUID_SIZE[0] / GX, FLUID_SIZE[1] / GY];
const JACOBI_ITERS = 24;

const P = {
  advect: program(FLUID_VS, ADVECT_FS), force: program(FLUID_VS, FORCE_FS),
  curl: program(FLUID_VS, CURL_FS), vort: program(FLUID_VS, VORTICITY_FS),
  div: program(FLUID_VS, DIVERGENCE_FS), jacobi: program(FLUID_VS, JACOBI_FS),
  project: program(FLUID_VS, PROJECT_FS),
};

function target() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, GX, GY);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo };
}
// velocity and pressure ping-pong; curl and divergence are single targets
let vel = [target(), target()], pres = [target(), target()];
const curlT = target(), divT = target();
const emptyVao = gl.createVertexArray();

// draw one full-grid pass of prog into dst, with textures bound in order
function pass(prog, dst, textures, setUniforms) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.useProgram(prog);
  gl.uniform2f(uni(prog, 'u_grid'), GX, GY);
  gl.uniform2f(uni(prog, 'u_cellPx'), CELL[0], CELL[1]);
  Object.entries(textures).forEach(([name, t], i) => {
    gl.activeTexture(gl.TEXTURE7 + i);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(uni(prog, name), 7 + i);
  });
  if (setUniforms) setUniforms(prog);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  Object.keys(textures).forEach((_, i) => {
    gl.activeTexture(gl.TEXTURE7 + i);
    gl.bindTexture(gl.TEXTURE_2D, null);
  });
  gl.activeTexture(gl.TEXTURE0);
}
const swapVel = () => { vel = [vel[1], vel[0]]; };

export function stepFluid(st) {
  if (st.dtr <= 0) return;
  gpuBegin('fluid');
  gl.disable(gl.DEPTH_TEST);
  gl.viewport(0, 0, GX, GY);
  gl.bindVertexArray(emptyVao);
  gl.activeTexture(gl.TEXTURE6);                 // never sampled while being written
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);

  const dt = u => gl.uniform1f(uni(u, 'u_dt'), st.dtr);
  pass(P.advect, vel[1], { u_vel: vel[0] }, dt); swapVel();
  pass(P.force, vel[1], { u_vel: vel[0] }, p => {
    dt(p);
    gl.uniform1f(uni(p, 'u_time'), st.t);
    gl.uniform2f(uni(p, 'u_origin'), FLUID_ORIGIN[0], FLUID_ORIGIN[1]);
    gl.uniform2f(uni(p, 'u_imgSize'), IMG_W, IMG_H);
    gl.uniform1f(uni(p, 'u_sep'), st.sep);
    gl.uniform1f(uni(p, 'u_ftime'), st.ftime);
  }); swapVel();
  pass(P.curl, curlT, { u_vel: vel[0] });
  pass(P.vort, vel[1], { u_vel: vel[0], u_curl: curlT }, dt); swapVel();
  pass(P.div, divT, { u_vel: vel[0] });
  for (let i = 0; i < JACOBI_ITERS; i++) {
    pass(P.jacobi, pres[1], { u_pres: pres[0], u_div: divT });
    pres = [pres[1], pres[0]];
  }
  pass(P.project, vel[1], { u_vel: vel[0], u_pres: pres[0] }); swapVel();

  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.DEPTH_TEST);
  gpuEnd();
}

// Binds the current velocity to unit 6 for a program that samples u_fluid.
export function bindFluid(p) {
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, vel[0].tex);
  gl.uniform1i(uni(p, 'u_fluid'), 6);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform2f(uni(p, 'u_fluidOrigin'), FLUID_ORIGIN[0], FLUID_ORIGIN[1]);
  gl.uniform2f(uni(p, 'u_fluidSize'), FLUID_SIZE[0], FLUID_SIZE[1]);
}
