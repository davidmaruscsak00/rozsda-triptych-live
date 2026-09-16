// Entry point: the desktop loop, which hands over to the XR loop in a session.
import { canvas, gl } from './gl/context.js';
import { tick } from './ui.js';
import { paintReady } from './scene/paint.js';
import { update, runShadowPass, drawScene } from './scene/render.js';
import { camBasis, camPos, flyStep, monoViewProj } from './view/camera.js';
import { initXR, inHeadset } from './view/xr.js';

function frame() {
  if (inHeadset()) return;            // the XR loop drives rendering instead
  requestAnimationFrame(frame);
  if (!paintReady()) return;
  const st = tick(false);
  flyStep(st.dtr);
  const { r: cr, d: cd, f: cf } = camBasis();
  const cp = camPos();
  const viewProj = monoViewProj(cr, cd, cf, cp, canvas.width, canvas.height);
  update(st);
  runShadowPass(st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  // stands in for passthrough, light enough for the shadow to read against
  gl.clearColor(0.50, 0.49, 0.47, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawScene(viewProj, cp, st, canvas.height);
}
initXR(() => requestAnimationFrame(frame));
frame();
