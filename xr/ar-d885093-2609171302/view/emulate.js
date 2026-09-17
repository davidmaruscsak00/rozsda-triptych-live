// A stand-in for the Quest session on a desktop GPU, for measuring and
// comparing builds without a headset. Each frame does the work view/xr.js does:
// simulation and shadow map once, then the scene once per eye into one 4x MSAA
// framebuffer as large as both eyes, seen by a viewer standing where the first
// drop puts the installation. The left eye is shown on the page.
//
//   ?headset=1 [&eye=2064x2208] [&fov=90]          Quest 3 panel per eye, fov in degrees
//   [&fixeddt=0.0139] [&bench=1] [&warmup=120] [&frames=240]
//
// With bench=1 every pass is timed with GPU syncs (gl/timers.js), and after
// warmup + frames the loop stops and publishes window.__bench. A desktop GPU
// is not a headset: the numbers rank builds, they do not predict Quest fps.
import { canvas, gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { mul4, xf4 } from '../gl/mat4.js';
import { BENCH, benchMs, benchPending, benchRecording, pollBench, extTimer } from '../gl/timers.js';
import { tick } from '../ui.js';
import { paintReady } from '../scene/paint.js';
import { update, runShadowPass, drawScene } from '../scene/render.js';
import { particleCount, particleCensus } from '../scene/particles.js';
import { place, BACK_M, updatePlacement, faceViewer } from './placement.js';
import * as placement from './placement.js';
import { qp } from '../config.js';

const [EYE_W, EYE_H] = (qp.get('eye') || '2064x2208').split('x').map(Number);
const TAN = Math.tan((parseFloat(qp.get('fov') || '90') / 2) * Math.PI / 180);
const WARMUP = parseInt(qp.get('warmup') || '120', 10);
const FRAMES = parseInt(qp.get('frames') || '240', 10);
const IPD = 0.064, EYE_Y = 1.6;

// the headset's eye buffer: both eyes side by side, 4x MSAA like the XR layer
function msaa(format) {
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, format, 2 * EYE_W, EYE_H);
  return rb;
}
const eyeFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, eyeFbo);
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaa(gl.RGBA8));
gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msaa(gl.DEPTH_COMPONENT24));
// the left eye resolved, to show on the page
const leftTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, leftTex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, EYE_W, EYE_H);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.bindTexture(gl.TEXTURE_2D, null);
const leftFbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, leftFbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, leftTex, 0);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

const showProg = program(`#version 300 es
uniform vec2 u_scale;
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p * u_scale, 0.0, 1.0);
}`, `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 o;
void main() {
  if (v_uv.x > 1.0 || v_uv.y > 1.0) discard;
  o = texture(u_tex, v_uv);
}`);
const emptyVao = gl.createVertexArray();

// standing at the origin looking down -z; the installation dropped BACK_M ahead
const head = { x: 0, y: EYE_Y, z: 0 };
place.x = 0; place.z = -BACK_M; place.placed = true;
faceViewer(head);
updatePlacement();

const near = 0.05, far = 100;
const proj = new Float32Array([
  1 / TAN, 0, 0, 0,
  0, 1 / TAN, 0, 0,
  0, 0, -(far + near) / (far - near), -1,
  0, 0, -2 * far * near / (far - near), 0,
]);

function publish() {
  const ms = {};
  let gpu = 0;
  for (const k in benchMs) { ms[k] = benchMs[k] / FRAMES; gpu += ms[k]; }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  window.__bench = {
    done: true, frames: FRAMES, particles: particleCount, eye: [EYE_W, EYE_H],
    gpu, cpu: cpuMs / FRAMES, ms, ...particleCensus(),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '',
  };
}

let frame = 0, cpuMs = 0, stopped = false;
export function emulateFrame() {
  window.__emu = { frame, stopped, pending: benchPending(), timer: !!extTimer, paint: paintReady() };
  if (stopped) {                           // measured: wait for the last queries
    pollBench();
    if (benchPending()) return true;
    publish();
    return false;
  }
  if (!paintReady()) return true;
  if (BENCH && !extTimer) throw new Error('bench needs EXT_disjoint_timer_query_webgl2');
  benchRecording(BENCH && frame >= WARMUP);
  const c0 = performance.now();
  const st = tick(true);
  update(st);
  runShadowPass(st);
  gl.bindFramebuffer(gl.FRAMEBUFFER, eyeFbo);
  gl.viewport(0, 0, 2 * EYE_W, EYE_H);
  gl.clearColor(0.50, 0.49, 0.47, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  for (let eye = 0; eye < 2; eye++) {
    const ex = (eye ? 0.5 : -0.5) * IPD;
    gl.viewport(eye * EYE_W, 0, EYE_W, EYE_H);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -ex, -head.y, -head.z, 1]);
    const viewProj = mul4(mul4(proj, view), placement.worldFromPainting);
    const cp = xf4(placement.paintingFromWorld, ex, head.y, head.z);
    gl.bindFramebuffer(gl.FRAMEBUFFER, eyeFbo);
    drawScene(viewProj, cp, st, EYE_H);
  }
  if (BENCH && frame >= WARMUP) cpuMs += performance.now() - c0;
  frame++;
  if (BENCH) {
    pollBench();
    if (frame === WARMUP) for (const k in benchMs) delete benchMs[k];
    if (frame === WARMUP + FRAMES) { benchRecording(false); stopped = true; }
  }
  // show the left eye, letterboxed
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, eyeFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, leftFbo);
  gl.blitFramebuffer(0, 0, EYE_W, EYE_H, 0, 0, EYE_W, EYE_H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(showProg);
  const ca = canvas.width / canvas.height, ea = EYE_W / EYE_H;
  gl.uniform2f(uni(showProg, 'u_scale'), ca > ea ? ea / ca : 1, ca > ea ? 1 : ca / ea);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, leftTex);
  gl.uniform1i(uni(showProg, 'u_tex'), 0);
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  return true;
}
