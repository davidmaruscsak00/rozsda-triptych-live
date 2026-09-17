// The Quest session: immersive VR in a neutral grey studio, the installation at
// a fixed place, controllers, and the per-frame XR loop that draws both eyes.
import { gl } from '../gl/context.js';
import { mul4, xf4 } from '../gl/mat4.js';
import { tick, sepEl, piecesEl, autoEl } from '../ui.js';
import { paintReady } from '../scene/paint.js';
import { update, runShadowPass, drawScene } from '../scene/render.js';
import { place, BACK_M, updatePlacement, faceViewer,
         worldFromPainting, paintingFromWorld } from './placement.js';
import { summonPanel, togglePanel, updatePanel, drawPanel, setPanelExit } from './panel.js';

// ---- the fixed place ------------------------------------------------------
// BACK_M ahead of the local-floor origin (where the wearer stands when the
// session starts, or last recentred with the Meta button), facing it. Nothing
// in the session moves it.
place.x = 0; place.z = -BACK_M;
faceViewer({ x: 0, z: 0 });
updatePlacement();

// the studio: the desktop preview's grey, which the floor shadow darkens
const STUDIO = [0.50, 0.49, 0.47];

// ---- WebXR session ------------------------------------------------------
let xrSession = null, xrSpace = null, xrFbo = null;
const selecting = new Set();              // input sources mid-select (hand pinches)
let headPose = null;
let panelUser = null;                      // the input source using the panel this frame
let panelPlaced = false;                   // the board is put in front of you once per session
const boardPress = new Set();              // sources whose current select began on the board
let bothPinchSince = 0;                    // when both hands started pinching together
const SUMMON_HOLD_MS = 1500;
// Both hands pinching for SUMMON_HOLD_MS brings the board back in front of you:
// the hand-tracking way to undo its hide button, and too deliberate for a visitor.
function twoHandSummon(session) {
  const pinching = [...session.inputSources].filter(src => src.hand && selecting.has(src));
  if (pinching.length < 2) { bothPinchSince = 0; return; }
  const now = performance.now();
  if (!bothPinchSince) bothPinchSince = now;
  if (now - bothPinchSince < SUMMON_HOLD_MS) return;
  bothPinchSince = Infinity;                // once per hold
  pinching.forEach(src => boardPress.add(src));
  if (headPose) summonPanel(headPose.position, headFwd(headPose.orientation));
}
setPanelExit(() => { if (xrSession) xrSession.end(); });
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

// Right stick drives Separate; A pieces, B auto play; left X hides the board,
// left Y calls it back.
function readControllers(session, dtr) {
  let sticksDown = 0;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const hand = src.handedness;
    const ax = gp.axes, bt = gp.buttons;
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
    }
  }
  // both thumbsticks clicked together leave VR, whether or not the panel is up
  if (edge('bothSticks', sticksDown >= 2)) session.end();
}
const vrBtn = document.getElementById('vr');
let onEnd = () => {};

export const inHeadset = () => !!xrSession;

// resume is called when the session ends, to restart the desktop loop
export function initXR(resume) {
  onEnd = resume;
  vrBtn.addEventListener('click', enterVR);
}
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr')
    .then(ok => { if (ok) vrBtn.hidden = false; })
    .catch(() => {});
}
async function enterVR() {
  if (xrSession) { xrSession.end(); return; }
  try {
    await gl.makeXRCompatible();
    const s = await navigator.xr.requestSession('immersive-vr',
      { optionalFeatures: ['local-floor', 'hand-tracking'] });
    xrSession = s;
    // antialias:true gives 4x MSAA that resolves inside tile memory on Adreno.
    const layer = new XRWebGLLayer(s, gl, { antialias: true, depth: true, alpha: false });
    s.updateRenderState({ baseLayer: layer });
    try { layer.fixedFoveation = 0.5; } catch (e) {}
    // local-floor puts y=0 on the real floor, so the studio floor is where your feet are
    xrSpace = await s.requestReferenceSpace('local-floor')
      .catch(() => s.requestReferenceSpace('local'));
    panelPlaced = false; boardPress.clear(); bothPinchSince = 0;
    selecting.clear();
    s.addEventListener('selectstart', e => {
      selecting.add(e.inputSource);
      if (e.inputSource === panelUser) boardPress.add(e.inputSource);
    });
    s.addEventListener('selectend', e => { selecting.delete(e.inputSource); boardPress.delete(e.inputSource); });
    vrBtn.textContent = 'Exit VR';
    s.addEventListener('end', () => {
      xrSession = null; xrFbo = null;
      vrBtn.textContent = 'Enter VR';
      onEnd();
    });
    s.requestAnimationFrame(onXRFrame);
  } catch (e) {
    vrBtn.textContent = 'VR failed: ' + e.message;
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
  if (!panelPlaced) {
    summonPanel(pose.transform.position, headFwd(pose.transform.orientation));
    panelPlaced = true;
  }
  headPose = pose.transform;
  readControllers(s, st.dtr);
  twoHandSummon(s);
  panelUser = updatePanel(xrFrame, s, xrSpace, selecting);
  update(st);   // once per frame, not once per eye
  runShadowPass(st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, xrFbo);
  gl.clearColor(STUDIO[0], STUDIO[1], STUDIO[2], 1);
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
