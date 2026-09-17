// The Quest session: passthrough, placement on the real floor, controllers,
// and the per-frame XR loop that draws both eyes.
import { gl } from '../gl/context.js';
import { mul4, xf4 } from '../gl/mat4.js';
import { tick, sepEl, piecesEl, autoEl } from '../ui.js';
import { paintReady } from '../scene/paint.js';
import { update, runShadowPass, drawScene } from '../scene/render.js';
import { place, BACK_M, updatePlacement, faceViewer,
         worldFromPainting, paintingFromWorld } from './placement.js';
import { summonPanel, togglePanel, updatePanel, drawPanel, setPanelExit, setPanelDistance } from './panel.js';

// ---- WebXR session ------------------------------------------------------
// No locomotion: in a room you walk around it on your own feet.
let xrSession = null, xrSpace = null, xrFbo = null;
const selecting = new Set();              // input sources mid-select (hand pinches)
let headPose = null;
let panelUser = null;                      // the input source using the panel this frame
setPanelExit(() => { if (xrSession) xrSession.end(); });
setPanelDistance(metres => {
  if (!headPose) return;
  const hp = headPose.position;
  const dx = place.x - hp.x, dz = place.z - hp.z, d = Math.hypot(dx, dz) || 1;
  const nd = Math.max(0.5, d + metres);
  place.x = hp.x + dx / d * nd;
  place.z = hp.z + dz / d * nd;
  faceViewer(hp);
});
function headFwd(q) {                       // head forward, flattened to the floor
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const l = Math.hypot(fx, fz) || 1;
  return [fx / l, fz / l];
}
const wasDown = new Map();
function edge(key, down) {                  // true on the frame a button goes down
  const prev = wasDown.get(key) || false;
  wasDown.set(key, down);
  return down && !prev;
}

// While carried, the installation rides the left hand's pointing ray where it
// meets the real floor, turned to face you. A select (trigger, or a pinch with
// bare hands) picks it up and puts it down again.
function carry(xrFrame, pose) {
  for (const src of xrSession.inputSources) {
    if (src.handedness !== 'left') continue;
    const rp = xrFrame.getPose(src.targetRaySpace, xrSpace);
    if (!rp) continue;
    const m = rp.transform.matrix;
    const oy = m[13], dx = -m[8], dy = -m[9], dz = -m[10];
    if (dy > -0.05) continue;               // pointing at or above the horizon
    const t = Math.min(-oy / dy, 15);
    place.x = m[12] + dx * t;
    place.z = m[14] + dz * t;
  }
  faceViewer(pose.transform.position);
}

// Right stick drives Separate. Left stick turns and resizes the piece to fit
// the room. Auto pulse is on by default so it performs itself if nobody
// touches a controller.
function readControllers(session, dtr) {
  let sticksDown = 0;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const hand = src.handedness;
    const ax = gp.axes, bt = gp.buttons;
    const sx = ax.length > 2 ? ax[2] : (ax[0] || 0);
    const sy = ax.length > 3 ? ax[3] : (ax[1] || 0);
    const dead = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    if (bt[3] && bt[3].pressed) sticksDown++;
    if (hand === 'right') {
      const d = dead(sy);
      if (d) {
        const v = Math.min(1, Math.max(0, parseFloat(sepEl.value) - d * dtr * 0.6));
        sepEl.value = String(v);
        autoEl.checked = false;             // taking the stick takes over
      }
      if (edge('r4', bt[4] && bt[4].pressed)) piecesEl.checked = !piecesEl.checked;
      if (edge('r5', bt[5] && bt[5].pressed)) autoEl.checked = !autoEl.checked;
    } else if (hand === 'left') {
      if (edge('l4', bt[4] && bt[4].pressed)) togglePanel();
      if (edge('l5', bt[5] && bt[5].pressed) && headPose)
        summonPanel(headPose.position, headFwd(headPose.orientation));
      place.turn -= dead(sx) * dtr * 1.2;
      place.height = Math.min(12, Math.max(0.3, place.height * Math.exp(-dead(sy) * dtr * 0.8)));
    }
  }
  // both thumbsticks clicked together leave AR, whether or not the panel is up
  if (edge('bothSticks', sticksDown >= 2)) session.end();
}
const vrBtn = document.getElementById('vr');
let onEnd = () => {};

export const inHeadset = () => !!xrSession;

// resume is called when the session ends, to restart the desktop loop
export function initXR(resume) {
  onEnd = resume;
  vrBtn.addEventListener('click', enterAR);
}
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar')
    .then(ok => { if (ok) vrBtn.hidden = false; })
    .catch(() => {});
}
async function enterAR() {
  if (xrSession) { xrSession.end(); return; }
  try {
    await gl.makeXRCompatible();
    const s = await navigator.xr.requestSession('immersive-ar',
      { optionalFeatures: ['local-floor', 'hand-tracking'] });
    xrSession = s;
    // antialias:true gives 4x MSAA that resolves inside tile memory on Adreno.
    // alpha:true is what lets passthrough through wherever nothing is drawn.
    const layer = new XRWebGLLayer(s, gl, { antialias: true, depth: true, alpha: true });
    s.updateRenderState({ baseLayer: layer });
    try { layer.fixedFoveation = 0.5; } catch (e) {}
    // local-floor puts y=0 on the real floor, which is the only thing the
    // shadow needs to land in the right place. 'local' would float it.
    xrSpace = await s.requestReferenceSpace('local-floor')
      .catch(() => s.requestReferenceSpace('local'));
    place.placed = false; place.carrying = false;
    selecting.clear();
    s.addEventListener('selectstart', e => selecting.add(e.inputSource));
    s.addEventListener('selectend', e => selecting.delete(e.inputSource));
    s.addEventListener('select', (e) => {
      // a pinch or trigger aimed at the panel belongs to the panel
      if (e.inputSource.handedness === 'left' && e.inputSource !== panelUser) place.carrying = !place.carrying;
    });
    vrBtn.textContent = 'Exit AR';
    s.addEventListener('end', () => {
      xrSession = null; xrFbo = null;
      vrBtn.textContent = 'Enter AR';
      onEnd();
    });
    s.requestAnimationFrame(onXRFrame);
  } catch (e) {
    vrBtn.textContent = 'AR failed: ' + e.message;
  }
}

function onXRFrame(tMs, xrFrame) {
  const s = xrSession;
  if (!s) return;
  s.requestAnimationFrame(onXRFrame);
  if (!paintReady()) return;
  const pose = xrFrame.getViewerPose(xrSpace);
  if (!pose) return;
  const layer = s.renderState.baseLayer;
  xrFbo = layer.framebuffer;
  const st = tick(true);
  const hp = pose.transform.position;
  if (!place.placed) {                      // first drop: ahead of wherever you look
    const [fx, fz] = headFwd(pose.transform.orientation);
    place.x = hp.x + fx * BACK_M;
    place.z = hp.z + fz * BACK_M;
    faceViewer(hp);
    place.placed = true;
    summonPanel(hp, [fx, fz]);
  }
  headPose = pose.transform;
  if (place.carrying) carry(xrFrame, pose);
  readControllers(s, st.dtr);
  panelUser = updatePanel(xrFrame, s, xrSpace, selecting);
  updatePlacement();
  update(st);   // once per frame, not once per eye
  runShadowPass(st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, xrFbo);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // Both eyes share one framebuffer, so clear once and draw per viewport.
  for (const view of pose.views) {
    const vp = layer.getViewport(view);
    gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const eyeViewProj = mul4(view.projectionMatrix, view.transform.inverse.matrix);
    const viewProj = mul4(eyeViewProj, worldFromPainting);
    const p = view.transform.position;
    const cp = xf4(paintingFromWorld, p.x, p.y, p.z);
    drawScene(viewProj, cp, st, vp.height);
    drawPanel(eyeViewProj);
  }
}
