// The desktop fallback's orbit camera. In a headset the XR views replace it.
import { canvas, gl } from '../gl/context.js';
import { mul4 } from '../gl/mat4.js';
import { qp, IMG_W, IMG_H } from '../config.js';

// ---- 3D camera: orbit / pan / zoom / fly ----
const cam = {
  target: [IMG_W / 2, IMG_H / 2, 0],
  yaw: 0, pitch: 0,
  dist: 2.0 * IMG_W,    // pulled back to frame all three panels
};
const CAM_HOME = JSON.parse(JSON.stringify(cam));
if (qp.has('yaw')) cam.yaw = parseFloat(qp.get('yaw'));
if (qp.has('pitch')) cam.pitch = parseFloat(qp.get('pitch'));
if (qp.has('dist')) cam.dist = parseFloat(qp.get('dist'));
export function camBasis() {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const f = [sy * cp, -sp, cy * cp];                       // forward
  const r = [cy, 0, -sy];                                  // right (world y is down)
  const d = [f[1]*r[2] - f[2]*r[1], f[2]*r[0] - f[0]*r[2], f[0]*r[1] - f[1]*r[0]]; // down = f x r
  return { f, r, d };
}
export function camPos() {
  const { f } = camBasis();
  return [cam.target[0] - f[0] * cam.dist,
          cam.target[1] - f[1] * cam.dist,
          cam.target[2] - f[2] * cam.dist];
}

let drag = null;   // {mode:'orbit'|'pan', x, y}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  drag = { mode: (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.mode === 'orbit') {
    cam.yaw -= dx * 0.005;
    cam.pitch = Math.min(1.35, Math.max(-1.35, cam.pitch + dy * 0.005));
  } else {
    const { r, d } = camBasis();
    const s = cam.dist / innerHeight * 1.2;
    for (let i = 0; i < 3; i++) cam.target[i] -= (r[i] * dx + d[i] * dy) * s;
  }
});
canvas.addEventListener('pointerup', () => drag = null);
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.dist = Math.min(9000, Math.max(250, cam.dist * Math.exp(e.deltaY * 0.001)));
}, { passive: false });
const camReset = () => Object.assign(cam, JSON.parse(JSON.stringify(CAM_HOME)));
canvas.addEventListener('dblclick', camReset);
document.getElementById('camreset').addEventListener('click', camReset);
const keys = {};
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
export function flyStep(dtr) {
  const { f, r, d } = camBasis();
  const s = cam.dist * 1.4 * dtr;
  const mv = (v, k) => { for (let i = 0; i < 3; i++) cam.target[i] += v[i] * k; };
  if (keys['w']) mv(f, s);
  if (keys['s']) mv(f, -s);
  if (keys['a']) mv(r, -s);
  if (keys['d']) mv(r, s);
  if (keys['q']) mv(d, -s);
  if (keys['e']) mv(d, s);
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
addEventListener('resize', resize);
resize();

const aspect = IMG_W / IMG_H;
const camDist = 1.5 * IMG_W;

// The desktop fallback reproduces the old inlined projection exactly, so
// screenshots stay diffable against index.html while the port proceeds.
export function monoViewProj(cr, cd, cf, cp, resW, resH) {
  const ca = resW / resH;
  const A = ca > aspect ? aspect / ca : 1;
  const B = ca > aspect ? 1 : ca / aspect;
  const Kx = 2 * A / IMG_W * camDist, Ky = 2 * B / IMG_H * camDist;
  const near = 40, far = camDist * 10;
  const dot = (v) => v[0] * cp[0] + v[1] * cp[1] + v[2] * cp[2];
  const V = new Float32Array([
    cr[0], cd[0], cf[0], 0,
    cr[1], cd[1], cf[1], 0,
    cr[2], cd[2], cf[2], 0,
    -dot(cr), -dot(cd), -dot(cf), 1,
  ]);
  const P = new Float32Array([
    Kx, 0, 0, 0,
    0, -Ky, 0, 0,
    0, 0, (far + near) / (far - near), 1,
    0, 0, -2 * far * near / (far - near), 0,
  ]);
  return mul4(P, V);
}
