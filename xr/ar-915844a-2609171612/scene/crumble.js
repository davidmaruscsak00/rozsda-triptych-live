// The crumble field (shaders/cycle.glsl.js), baked. The pieces tested it for
// every pixel of both eyes and the particles for every particle, and its four
// value noises were most of the frame. Now the static grain is baked once, at
// painting resolution, and the broad drifting regions once per frame, one
// texel per REGION_PX painting px (their finest octave spans about 50 px).
// Both are texture arrays with one layer per panel. Linear filtering moves the
// crumble edge by a fraction of a painting px; ?bake=0 compares.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { CYCLE_EXACT, BAKE } from '../shaders/cycle.glsl.js';
import { IMG_W, IMG_H } from '../config.js';

const REGION_PX = 4;
const GRAIN = [IMG_W, IMG_H];
const REGIONS = [Math.ceil(IMG_W / REGION_PX), Math.ceil(IMG_H / REGION_PX)];

const BAKE_VS = `#version 300 es
void main() {
  gl_Position = vec4(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0, 0.0, 1.0);
}`;
// px of a texel centre is where linear filtering reproduces it exactly
const bakeFS = body => `#version 300 es
precision highp float;
uniform vec2  u_pxPerTexel;
uniform float u_panel;
uniform float u_t;
out vec4 o;
${CYCLE_EXACT}
void main() {
  vec2 px = gl_FragCoord.xy * u_pxPerTexel;
  o = vec4(${body}, 0.0, 0.0, 1.0);
}`;

// rendering into R16F needs this enabled before the first bake, which runs at load
if (BAKE && !gl.getExtension('EXT_color_buffer_float'))
  throw new Error('EXT_color_buffer_float is required to bake the crumble field');

function fieldArray([w, h]) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R16F, w, h, 3);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  const fbos = [0, 1, 2].map(layer => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, layer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('crumble field target is not renderable');
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex: t, fbos, size: [w, h] };
}

const emptyVao = gl.createVertexArray();
function bake(target, prog, t) {
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  gl.uniform2f(uni(prog, 'u_pxPerTexel'), IMG_W / target.size[0], IMG_H / target.size[1]);
  gl.uniform1f(uni(prog, 'u_t'), t);
  gl.viewport(0, 0, target.size[0], target.size[1]);
  gl.bindVertexArray(emptyVao);
  for (let panel = 0; panel < 3; panel++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbos[panel]);
    gl.uniform1f(uni(prog, 'u_panel'), panel);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.DEPTH_TEST);
}

let grain = null, regions = null, regionsProg = null;
if (BAKE) {
  grain = fieldArray(GRAIN);
  regions = fieldArray(REGIONS);
  regionsProg = program(BAKE_VS, bakeFS('crumbleRegions(px, u_panel, u_t)'));
  bake(grain, program(BAKE_VS, bakeFS('crumbleGrain(px, u_panel)')), 0);
}

// Once per frame, before anything reads the field. ctime is the crumble clock.
export function bakeCrumble(ctime) {
  if (!BAKE) return;
  gpuBegin('crumble');
  gl.activeTexture(gl.TEXTURE9);                 // never sampled while being written
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  gl.activeTexture(gl.TEXTURE0);
  bake(regions, regionsProg, ctime);
  gpuEnd();
}

// For a program that includes CYCLE; units 9 and 10.
export function bindCrumble(p) {
  if (!BAKE) return;
  gl.activeTexture(gl.TEXTURE9);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, regions.tex);
  gl.uniform1i(uni(p, 'u_crumbleRegions'), 9);
  gl.activeTexture(gl.TEXTURE10);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, grain.tex);
  gl.uniform1i(uni(p, 'u_crumbleGrain'), 10);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform2f(uni(p, 'u_crumbleSize'), IMG_W, IMG_H);
}
