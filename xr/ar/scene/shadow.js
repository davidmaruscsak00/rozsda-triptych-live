// The shadow pass, and the shadow on the real floor: a floor quad that draws
// nothing but black at the shadow's strength. The light and its map live in
// light.js.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { gpuBegin, gpuEnd } from '../gl/timers.js';
import { FLOOR_VS, FLOOR_FS } from '../shaders/floor.glsl.js';
import { shadowTex, shadowFbo, lightVP, casterPts, useShadowAsTarget } from './light.js';
import { IMG_W, IMG_H, FRAME_Z_FRONT, FRAME_Z_BACK, FW, FLOOR_Y,
         SHADOW_RES, SUN_ELEV } from '../config.js';

const flProg = program(FLOOR_VS, FLOOR_FS);

// The receiver: a floor quad covering the casters' footprint plus the
// longest shadow they can throw and the contact falloff. It draws nothing
// but black at the shadow's alpha.
const CONTACT_PX = 140;
const flVao = gl.createVertexArray();
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of casterPts) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  const reach = (FLOOR_Y + FW + 300) / Math.tan(SUN_ELEV) + 6 * CONTACT_PX;
  const Y = FLOOR_Y;
  const quad = new Float32Array([x0 - reach, Y, z0 - reach,  x1 + reach, Y, z0 - reach,
                                 x1 + reach, Y, z1 + reach,  x0 - reach, Y, z1 + reach]);
  gl.bindVertexArray(flVao);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(flProg, 'a_p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// Once per frame. drawCasters(viewProj) draws everything depth-only.
export function renderShadowMap(drawCasters) {
  gpuBegin('shadow');
  useShadowAsTarget(true);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1.5, 4.0);
  drawCasters(lightVP);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  useShadowAsTarget(false);
  gpuEnd();
}

// Once per eye, after the installation, so it already owns the depth it hides.
// No depth write: it is a stain on a surface that is not in the scene.
export function drawFloor(viewProj) {
  gl.useProgram(flProg);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.uniform1i(uni(flProg, 'u_shadow'), 1);
  gl.uniformMatrix4fv(uni(flProg, 'u_viewProj'), false, viewProj);
  gl.uniformMatrix4fv(uni(flProg, 'u_lightVP'), false, lightVP);
  gl.uniform1f(uni(flProg, 'u_texel'), 1 / SHADOW_RES);
  gl.uniform2f(uni(flProg, 'u_imgSize'), IMG_W, IMG_H);
  gl.uniform2f(uni(flProg, 'u_frameZ'), FRAME_Z_FRONT, FRAME_Z_BACK + 28);
  gl.uniform1f(uni(flProg, 'u_frameW'), FW);
  gl.uniform1f(uni(flProg, 'u_strength'), 0.62);
  gl.uniform1f(uni(flProg, 'u_contact'), CONTACT_PX);
  gl.uniform1f(uni(flProg, 'u_penumbra'), 0.04);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);             // premultiplied
  gl.bindVertexArray(flVao);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.bindTexture(gl.TEXTURE_2D, null);                        // never bound while it is a target
  gl.activeTexture(gl.TEXTURE0);
}
