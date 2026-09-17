import { gl } from './context.js';
import { qp } from '../config.js';

// Real GPU time per pass. Frame time alone cannot tell the field pass apart
// from the draw, and on a tiler those two have very different cures.
export const extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
export const gpuMs = { xform: 0, crumble: 0, fluid: 0, sim: 0, field: 0, shadow: 0, draw: 0, scene: 0 };

// ?bench=1 (view/emulate.js): every query is kept and summed per pass into
// benchMs, which the emulator reads and resets. gl.finish cannot stand in for
// the queries: through Chrome's GPU process it returns before the work is done.
export const BENCH = qp.get('bench') === '1';
export const benchMs = {};
const benchQueries = [];
export const benchPending = () => benchQueries.length;
export function pollBench() {
  for (let i = benchQueries.length - 1; i >= 0; i--) {
    const { q, pass } = benchQueries[i];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
    if (!gl.getParameter(extTimer.GPU_DISJOINT_EXT))
      benchMs[pass] = (benchMs[pass] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(q);
    benchQueries.splice(i, 1);
  }
}
let benchOn = false;
export function benchRecording(on) { benchOn = on; }

// Passes may nest (the shadow pass draws the particles, which time themselves
// in an eye); only the outermost one is measured, since queries cannot overlap.
let depth = 0, tq = null, tqPass = 'field';
export function gpuBegin(pass) {
  if (depth++ > 0 || !extTimer) return;
  if (BENCH && !benchOn) return;
  tqPass = pass; tq = gl.createQuery();
  gl.beginQuery(extTimer.TIME_ELAPSED_EXT, tq);
}
export function gpuEnd() {
  if (--depth > 0 || !extTimer || !tq) return;
  gl.endQuery(extTimer.TIME_ELAPSED_EXT);
  const q = tq, pass = tqPass; tq = null;
  if (BENCH) { benchQueries.push({ q, pass }); return; }
  setTimeout(() => {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) &&
        !gl.getParameter(extTimer.GPU_DISJOINT_EXT))
      gpuMs[pass] = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(q);
  }, 60);
}
