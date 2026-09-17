// The one light: its direction, the shadow map it casts into, and what every
// lit program needs to read both. Everything is in painting space, so the
// light turns with the installation. The Light slider turns it around the
// vertical; its elevation stays steep (?sun=, default 60 degrees), as a room is
// lit from the ceiling and a low sun would throw shadows through the real wall.
import { gl, uni } from '../gl/context.js';
import { txPanel } from './fold.js';
import { IMG_W, EDGE_W, FLOOR_Y, FRAME_Z_BACK, SHADOW_RES, SUN_ELEV } from '../config.js';

// ---- shadow map ------------------------------------------------------------
// One depth map per frame, shared by both eyes: the light's view does not
// depend on the eye. It is its own render pass that ends before the eye pass
// begins, so a tiler resolves nothing mid-pass.
function depthTexture(size) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}
export const shadowTex = depthTexture(SHADOW_RES);
// bound in the shadow map's place while the shadow map itself is the target,
// since the lit programs also draw into it and must not sample what they write
const dummyShadow = depthTexture(1);
export const shadowFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// ---- direction and the light's view ------------------------------------------
// Bounds of everything that can cast: the unfolded sheet generously padded for
// the swell, the box relief, the departure arc and the particles' reach,
// folded per panel.
export const casterPts = [];
{
  const y0 = -EDGE_W - 300, y1 = FLOOR_Y + 200, z0 = -900, z1 = FRAME_Z_BACK + 60;
  for (const [xa, xb, panel] of [[-IMG_W / 2 - EDGE_W - 150, 0, 1], [0, IMG_W, 0],
                                 [IMG_W, 1.5 * IMG_W + EDGE_W + 150, 2]])
    for (const x of [xa, xb]) for (const y of [y0, y1]) for (const z of [z0, z1])
      casterPts.push(txPanel([x, y, z], panel));
}

export const lightDir = new Float32Array(3);     // toward the light, y down
export const lightVP = new Float32Array(16);
let azimuth = null;

// slider 0..1 turns the light all the way round; about 0.554 is the original
// direction, from the front and a little to the right
export function setLight(slider) {
  const a = (slider - 0.5) * 2 * Math.PI;
  if (a === azimuth) return;
  azimuth = a;
  const c = Math.cos(SUN_ELEV);
  lightDir.set([Math.sin(a) * c, -Math.sin(SUN_ELEV), -Math.cos(a) * c]);

  const f = [-lightDir[0], -lightDir[1], -lightDir[2]];      // light travel direction
  const ref = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (p, q) => [p[1]*q[2] - p[2]*q[1], p[2]*q[0] - p[0]*q[2], p[0]*q[1] - p[1]*q[0]];
  const norm = (p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0]/l, p[1]/l, p[2]/l]; };
  const r = norm(cross(ref, f)), u = cross(f, r);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of casterPts) {
    const q = [r[0]*p[0] + r[1]*p[1] + r[2]*p[2],
               u[0]*p[0] + u[1]*p[1] + u[2]*p[2],
               f[0]*p[0] + f[1]*p[1] + f[2]*p[2]];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); }
  }
  // the floor has to sit inside the depth range too, however far it runs
  hi[2] += (hi[2] - lo[2]);
  const sx = 2 / (hi[0] - lo[0]), sy = 2 / (hi[1] - lo[1]), sz = 2 / (hi[2] - lo[2]);
  lightVP.set([
    sx * r[0], sy * u[0], sz * f[0], 0,
    sx * r[1], sy * u[1], sz * f[1], 0,
    sx * r[2], sy * u[2], sz * f[2], 0,
    -sx * (lo[0] + hi[0]) / 2, -sy * (lo[1] + hi[1]) / 2, -sz * (lo[2] + hi[2]) / 2, 1,
  ]);
}
setLight(0.554);

// ---- binding -----------------------------------------------------------------
let shadowBound = true;
// while drawing into the shadow map, lit programs read a 1x1 stand-in
export function useShadowAsTarget(asTarget) { shadowBound = !asTarget; }

// For a program that includes LIGHT (shaders/light.glsl.js); unit 1.
export function bindLight(p) {
  gl.uniform3fv(uni(p, 'u_lightDir'), lightDir);
  gl.uniformMatrix4fv(uni(p, 'u_lightVP'), false, lightVP);
  gl.uniform1f(uni(p, 'u_shadowTexel'), 1 / SHADOW_RES);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, shadowBound ? shadowTex : dummyShadow);
  gl.uniform1i(uni(p, 'u_shadow'), 1);
  gl.activeTexture(gl.TEXTURE0);
}
