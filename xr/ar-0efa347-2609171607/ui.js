// The panel, and the per-frame clock it drives.
import { qp, N_PARTICLES, SHOW_CHIPS, N_POINTS } from './config.js';
import { extTimer, gpuMs } from './gl/timers.js';
import { createAutoplay } from './autoplay.js';

export const sepEl = document.getElementById('sep');
// Quality reloads with a new particle count (the buffers are built at load),
// keeping every other URL setting
const qualityEl = document.getElementById('quality');
qualityEl.value = [...qualityEl.options].map(o => +o.value)
  .reduce((a, b) => Math.abs(b - N_POINTS) < Math.abs(a - N_POINTS) ? b : a);
qualityEl.addEventListener('change', () => {
  const q = new URLSearchParams(location.search);
  q.set('particles', qualityEl.value);
  location.search = q.toString();
});
export const piecesEl = document.getElementById('pieces');
export const driftEl = document.getElementById('drift');
export const autoEl = document.getElementById('auto');
// stage two: how much of the broken-off pieces is particles, how they move
// (0 hover near their piece, 1 the big swirl), and how fast the crumbling and
// reforming drifts on its own (0: only the Crumble slider moves it)
export const crumbleEl = document.getElementById('crumble');
export const swirlEl = document.getElementById('swirl');
export const rhythmEl = document.getElementById('rhythm');
export const formEl = document.getElementById('form');         // raises the Judit facade in the centre panel
export const lightEl = document.getElementById('light');       // turns the light around the vertical
export const gravityEl = document.getElementById('gravity');   // 0 weightless .. 1 drips and pools
if (qp.has('sep')) sepEl.value = qp.get('sep');
for (const [k, el] of [['crumble', crumbleEl], ['swirl', swirlEl], ['rhythm', rhythmEl], ['gravity', gravityEl], ['light', lightEl], ['form', formEl]])
  if (qp.has(k)) el.value = qp.get(k);
if (qp.get('pieces') === '0') piecesEl.checked = false;
// Automatic playback runs unless ?auto=0 or a slider is moved by hand (here, or
// on the board inside AR, which switches it off the same way).
const playSliders = { sep: sepEl, crumble: crumbleEl, swirl: swirlEl, gravity: gravityEl,
                      form: formEl, light: lightEl, rhythm: rhythmEl };
const autoplay = createAutoplay(playSliders);
autoEl.checked = qp.get('auto') !== '0' && ![...Object.keys(playSliders)].some(k => qp.has(k));
for (const el of Object.values(playSliders))
  el.addEventListener('input', () => { autoEl.checked = false; });
// The menu folds away to a single button; M toggles it too. Remembered per
// browser, and the piece works the same whether it is open or not.
const menuEl = document.getElementById('ui');
const menuBtn = document.getElementById('menu-toggle');
function setMenu(open) {
  menuEl.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? '×' : '≡';
  try { localStorage.setItem('ar.menu', open ? '1' : '0'); } catch (e) {}
}
let menuOpen = true;
try { menuOpen = localStorage.getItem('ar.menu') !== '0'; } catch (e) {}
setMenu(menuOpen);
menuBtn.addEventListener('click', () => setMenu(menuEl.hidden));
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key.toLowerCase() === 'm' && !e.repeat) setMenu(menuEl.hidden);
});

let ftEma = 16;                         // smoothed frame time, for the HUD only
const t0 = performance.now();
let ftime = 0, ctime = 0, form = 0, lastT = 0;   // flow clock: only advances while separating
let statAcc = 0;
const statsEl = document.getElementById('stats');

// ---- per-frame state ---------------------------------------------------
// Called once per frame. inHeadset mirrors the stats line to the console,
// because inside a headset the DOM is not visible.
// ?fixeddt= steps the clock by that many seconds a frame whatever the wall
// clock does, so two builds can be compared frame for frame.
const FIXED_DT = parseFloat(qp.get('fixeddt') || '0');
let frameNo = 0;
export function tick(inHeadset) {
  frameNo++;
  const t = FIXED_DT > 0 ? frameNo * FIXED_DT : (performance.now() - t0) / 1000;
  autoplay(autoEl.checked, t);
  const sep = parseFloat(sepEl.value);
  const drift = driftEl.checked ? 1 : 0;
  const rawMs = (t - lastT) * 1000;
  const dtr = Math.min(0.05, Math.max(0, t - lastT));
  lastT = t;
  if (rawMs > 0 && rawMs < 500) ftEma = ftEma * 0.9 + rawMs * 0.1;
  ftime += dtr * Math.min(1, sep / 0.25);   // frozen at sep 0, full speed past 0.25
  ctime += dtr * 2 * parseFloat(rhythmEl.value);   // accumulated, so Rhythm never jumps
  // the figure assembles and comes apart slowly, whatever the slider does
  form += (parseFloat(formEl.value) - form) * (1 - Math.exp(-dtr / 4));
  statAcc += dtr;
  if (statAcc > 0.5) {
    statAcc = 0;
    const line = (1000 / Math.max(0.1, ftEma)).toFixed(0) + ' fps · ' + ftEma.toFixed(1) + ' ms'
      + (extTimer ? ' · sim ' + (gpuMs.xform + gpuMs.crumble + gpuMs.fluid + gpuMs.sim + gpuMs.field).toFixed(2) + ' · shadow ' + gpuMs.shadow.toFixed(2) + ' · particles ' + gpuMs.draw.toFixed(2) + ' ms' : '')
      + (SHOW_CHIPS ? ' · ' + N_PARTICLES.toLocaleString() + ' chips' : '');
    if (statsEl) statsEl.textContent = line + ' · build ' + (window.BUILD || 'local');
    // inside a headset the DOM is not visible, so mirror it somewhere a
    // chrome://inspect session over adb can read while the piece is running
    if (inHeadset) console.log('[ar] ' + line);
  }
  return { sep, drift, dtr, t, ftime, ctime,
           crumble: parseFloat(crumbleEl.value), swirl: parseFloat(swirlEl.value),
           gravity: parseFloat(gravityEl.value), light: parseFloat(lightEl.value), form };
}
