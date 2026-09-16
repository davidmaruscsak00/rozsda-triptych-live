import { gl } from './context.js';

// Real GPU time per pass. Frame time alone cannot tell the field pass apart
// from the draw, and on a tiler those two have very different cures.
export const extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
export const gpuMs = { field: 0, shadow: 0, draw: 0 };
let tq = null, tqPass = 'field';
export function gpuBegin(pass) {
  if (!extTimer || tq) return;
  tqPass = pass; tq = gl.createQuery();
  gl.beginQuery(extTimer.TIME_ELAPSED_EXT, tq);
}
export function gpuEnd() {
  if (!extTimer || !tq) return;
  gl.endQuery(extTimer.TIME_ELAPSED_EXT);
  const q = tq, pass = tqPass; tq = null;
  setTimeout(() => {
    if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) &&
        !gl.getParameter(extTimer.GPU_DISJOINT_EXT))
      gpuMs[pass] = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(q);
  }, 60);
}
