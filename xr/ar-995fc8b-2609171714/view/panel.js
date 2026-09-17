// The control panel inside VR: every slider and toggle of the page's own panel,
// drawn on a floating board, worked by touching it with a fingertip, or pointing
// with a controller ray + trigger or a hand ray + pinch. It drives the page's inputs directly, so the page's
// panel and this one are always the same state.
//
// It appears in front of you on entering VR. Its hide button or left X hides it;
// left Y, or pinching with both hands for a second and a half, calls it back in
// front of you. Its last row leaves VR.
import { gl, uni } from '../gl/context.js';
import { program } from '../gl/program.js';
import { PANEL_VS, PANEL_FS } from '../shaders/panel.glsl.js';

const ROWS = [
  ['Separate', 'sep'], ['Crumble', 'crumble'], ['Swirl', 'swirl'], ['Form', 'form'],
  ['Gravity', 'gravity'], ['Light', 'light'], ['Rhythm', 'rhythm'],
  ['Pieces', 'pieces'], ['Turbulence', 'drift'], ['Auto play', 'auto'],
].map(([label, id]) => ({ label, el: document.getElementById(id) }));
ROWS.push({ label: 'Session', action: 'exit' });
let onExit = () => {};
export function setPanelExit(fn) { onExit = fn; }
// which build is running, so a stale cache is visible at a glance
const BUILD = window.BUILD || 'local';
// what the browser reports for each input, refreshed a few times a second
let inputsText = '', inputsAt = 0;

// canvas layout, px
const HIDE_X0 = 392;                            // the header's hide button runs from here to the right edge
const CW = 512, CH = 64 + 56 * ROWS.length + 64, HEAD = 64, ROW_H = 56, TRACK_X0 = 196, TRACK_X1 = 470;
const W_M = 0.34, H_M = W_M * CH / CW;          // panel size, metres

const canvas = document.createElement('canvas');
canvas.width = CW; canvas.height = CH;
const ctx = canvas.getContext('2d');

const prog = program(PANEL_VS, PANEL_FS);
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.bindTexture(gl.TEXTURE_2D, null);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
// panel: two triangles; ray: the first two vertices' x (-0.5, 0.5) as its ends
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// ---- state ------------------------------------------------------------------
const panel = { visible: true, c: [0, 1.2, -0.6], r: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1] };
let hover = null;            // { row, x, y } in canvas px, or null
let grabbed = -1;            // slider row being dragged
let ray = null;              // { a, b } world
let pressedBefore = false;
let lastDrawn = '';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// in front of the head, a little low, turned to face it
export function summonPanel(headPos, headFwdXZ) {
  const [fx, fz] = headFwdXZ;
  panel.c = [headPos.x + fx * 0.55 - fz * 0.12, headPos.y - 0.18, headPos.z + fz * 0.55 + fx * 0.12];
  panel.n = norm([headPos.x - panel.c[0], 0.35 * (headPos.y - panel.c[1]), headPos.z - panel.c[2]]);
  const forward = [-panel.n[0], -panel.n[1], -panel.n[2]];
  panel.r = norm(cross(forward, [0, 1, 0]));
  panel.u = cross(panel.r, forward);
  panel.visible = true;
}
export function togglePanel() { panel.visible = !panel.visible; }

// ---- drawing the board --------------------------------------------------------
function redraw() {
  const sig = inputsText + +(hover && hover.hide) + ROWS.map(r => !r.el ? '' : r.el.type === 'checkbox' ? +r.el.checked : (+r.el.value).toFixed(3)).join()
            + '|' + (hover ? hover.row : -1) + '|' + grabbed;
  if (sig === lastDrawn) return;
  lastDrawn = sig;
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = 'rgba(14, 13, 12, 0.88)';
  ctx.beginPath(); ctx.roundRect(4, 4, CW - 8, CH - 8, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#d8d2c4';
  ctx.font = '600 26px "Segoe UI", system-ui, sans-serif';
  ctx.fillText('Rozsda', 28, 44);
  ctx.font = '18px "Segoe UI", system-ui, sans-serif';
  ctx.globalAlpha = 0.5;
  ctx.fillText('build ' + BUILD, 130, 44);
  ctx.globalAlpha = 1;
  // hide button, top right
  ctx.fillStyle = hover && hover.hide ? 'rgba(217, 164, 65, 1)' : 'rgba(217, 164, 65, 0.85)';
  ctx.beginPath(); ctx.roundRect(HIDE_X0, 14, CW - 20 - HIDE_X0, 36, 10); ctx.fill();
  ctx.fillStyle = '#1b1a18'; ctx.font = '600 20px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('hide', (HIDE_X0 + CW - 20) / 2, 39);
  ctx.textAlign = 'left';
  ROWS.forEach((row, i) => {
    const y = HEAD + i * ROW_H, mid = y + ROW_H / 2;
    if (hover && hover.row === i || grabbed === i) {
      ctx.fillStyle = 'rgba(217, 164, 65, 0.14)';
      ctx.beginPath(); ctx.roundRect(12, y + 4, CW - 24, ROW_H - 8, 12); ctx.fill();
    }
    ctx.fillStyle = '#d8d2c4';
    ctx.font = '24px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(row.label, 28, mid + 8);
    if (row.action === 'exit') {
      ctx.fillStyle = 'rgba(200, 80, 60, 0.85)';
      ctx.beginPath(); ctx.roundRect(TRACK_X0, mid - 18, TRACK_X1 - TRACK_X0, 36, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Leave VR', TRACK_X0 + 90, mid + 8);
    } else if (row.el.type === 'checkbox') {
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(TRACK_X0, mid - 15, 30, 30, 7); ctx.stroke();
      if (row.el.checked) {
        ctx.fillStyle = '#d9a441';
        ctx.beginPath(); ctx.roundRect(TRACK_X0 + 6, mid - 9, 18, 18, 4); ctx.fill();
      }
    } else {
      const v = +row.el.value, x = TRACK_X0 + v * (TRACK_X1 - TRACK_X0);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath(); ctx.roundRect(TRACK_X0, mid - 4, TRACK_X1 - TRACK_X0, 8, 4); ctx.fill();
      ctx.fillStyle = '#d9a441';
      ctx.beginPath(); ctx.roundRect(TRACK_X0, mid - 4, x - TRACK_X0, 8, 4); ctx.fill();
      ctx.beginPath(); ctx.arc(x, mid, grabbed === i ? 15 : 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.font = '17px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(v.toFixed(2), TRACK_X1 + 8 > CW - 40 ? CW - 44 : TRACK_X1 + 8, mid - 14);
      ctx.globalAlpha = 1;
    }
  });
  ctx.globalAlpha = 0.55; ctx.fillStyle = '#d8d2c4'; ctx.font = '15px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(inputsText || 'no inputs reported', 28, CH - 22);
  ctx.globalAlpha = 1;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

// ---- pointing -----------------------------------------------------------------
// Every hand or controller can use the board, in two ways:
//  - touch: with tracked hands, the index fingertip pokes the board directly
//    (pressed once it reaches the surface);
//  - point: a ray from any input source, pressed by the trigger or a pinch
//    (a hand's gamepad reports no buttons on some browsers, so select events
//    count as a press too).
// Whichever source is closest to the board drives it; a source that grabbed a
// slider keeps it until it lets go. Returns the input source using the board,
// or null, so the caller can keep that source's other bindings quiet.
const TOUCH_HOVER = 0.08, TOUCH_PRESS = 0.012;   // metres in front of the board
let active = null, activeTouch = false;          // the source that owns the grab, and whether by fingertip

function boardPoint(p) {
  const q = sub(p, panel.c);
  return [(dot(q, panel.r) / W_M + 0.5) * CW, (0.5 - dot(q, panel.u) / H_M) * CH, dot(q, panel.n)];
}
const onBoard = (x, y) => x >= 0 && x <= CW && y >= 0 && y <= CH;

function probe(xrFrame, src, space, selecting) {
  const clickPressed = !!(src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed)
                    || selecting.has(src);
  // touch with the index fingertip
  if (src.hand && xrFrame.getJointPose) {
    const joint = src.hand.get('index-finger-tip');
    const jp = joint && xrFrame.getJointPose(joint, space);
    if (jp) {
      const tip = [jp.transform.position.x, jp.transform.position.y, jp.transform.position.z];
      const [x, y, dist] = boardPoint(tip);
      if ((onBoard(x, y) || active === src) && dist < TOUCH_HOVER && dist > -0.08)
        return { src, x, y, pressed: dist < TOUCH_PRESS, near: dist, ray: null, touch: true };
    }
  }
  // point with the target ray
  const pose = xrFrame.getPose(src.targetRaySpace, space);
  if (!pose) return null;
  const m = pose.transform.matrix;
  const o = [m[12], m[13], m[14]], d = [-m[8], -m[9], -m[10]];
  const denom = dot(d, panel.n);
  if (Math.abs(denom) < 1e-4) return null;
  const t = dot(sub(panel.c, o), panel.n) / denom;
  if (!(t > 0 && t < 3)) return null;
  const hit = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const [x, y] = boardPoint(hit);
  if (!onBoard(x, y) && active !== src) return null;
  return { src, x, y, pressed: clickPressed, near: t, ray: { a: o, b: hit } };
}

export function updatePanel(xrFrame, session, space, selecting) {
  hover = null; ray = null;
  describeInputs(xrFrame, session, space, selecting);
  if (!panel.visible) { grabbed = -1; active = null; pressedBefore = false; redraw(); return null; }

  let use = null;
  for (const src of session.inputSources) {
    const p = probe(xrFrame, src, space, selecting);
    if (!p) continue;
    if (p.src === active) { use = p; break; }          // the grabbing source keeps the board
    if (!use || p.near < use.near) use = p;
  }
  if (!use) {
    if (active) { grabbed = -1; active = null; pressedBefore = false; }
    redraw();
    return null;
  }
  // a press already held does not click, and neither does a hand switching
  // between its ray and its fingertip (the fingertip arriving behind the board,
  // or a joint dropout, would otherwise click wherever it lands)
  if (use.src !== active || !!use.touch !== activeTouch) pressedBefore = use.pressed;
  active = use.src; activeTouch = !!use.touch;
  const row = Math.floor((use.y - HEAD) / ROW_H);
  hover = { row: row >= 0 && row < ROWS.length ? row : -1, x: use.x, y: use.y,
            hide: use.y >= 14 && use.y <= 50 && use.x >= HIDE_X0 && use.x <= CW - 20 };   // the drawn button only
  ray = use.ray;
  if (hover.hide && use.pressed && !pressedBefore) {
    panel.visible = false; grabbed = -1; active = null; pressedBefore = false; hover = null; ray = null;
    return use.src;                                     // this press belongs to the board
  }

  // press on a row: toggles flip, sliders grab; while held a grabbed slider follows
  if (use.pressed && !pressedBefore && hover.row >= 0) {
    const el = ROWS[hover.row].el;
    if (ROWS[hover.row].action === 'exit') onExit();
    else if (el.type === 'checkbox') el.checked = !el.checked;
    else grabbed = hover.row;
    // taking a slider takes over from automatic playback
    if (el && el.type === 'range') document.getElementById('auto').checked = false;
  }
  if (!use.pressed) grabbed = -1;
  if (grabbed >= 0) {
    const v = Math.min(1, Math.max(0, (hover.x - TRACK_X0) / (TRACK_X1 - TRACK_X0)));
    ROWS[grabbed].el.value = String(v);
  }
  pressedBefore = use.pressed;
  if (!use.pressed && !onBoard(use.x, use.y)) active = null;
  redraw();
  return use.src;
}

// e.g. "R hand tip 6cm pinch · L controller": handedness, kind, fingertip
// distance to the board (negative = through it), and whether it is pressing
function describeInputs(xrFrame, session, space, selecting) {
  const now = performance.now();
  if (now - inputsAt < 250) return;
  inputsAt = now;
  const parts = [];
  for (const src of session.inputSources) {
    let t = (src.handedness || '?')[0].toUpperCase() + (src.hand ? ' hand' : ' ctrl');
    if (src.hand && xrFrame.getJointPose) {
      const joint = src.hand.get('index-finger-tip');
      const jp = joint && xrFrame.getJointPose(joint, space);
      if (jp) {
        const p = jp.transform.position;
        t += ' tip ' + Math.round(boardPoint([p.x, p.y, p.z])[2] * 100) + 'cm';
      } else t += ' no joints';
    }
    const btn = !!(src.gamepad && src.gamepad.buttons[0] && src.gamepad.buttons[0].pressed);
    if (btn || selecting.has(src)) t += ' press';
    parts.push(t);
  }
  inputsText = parts.join(' · ');
}

// ---- drawing into an eye --------------------------------------------------------
// worldViewProj is the eye's projection * view, without the installation's placement.
export function drawPanel(worldViewProj) {
  if (!panel.visible) return;
  gl.useProgram(prog);
  gl.uniformMatrix4fv(uni(prog, 'u_viewProj'), false, worldViewProj);
  const { c, r, u, n } = panel;
  gl.uniformMatrix4fv(uni(prog, 'u_model'), false, new Float32Array([
    r[0] * W_M, r[1] * W_M, r[2] * W_M, 0, u[0] * H_M, u[1] * H_M, u[2] * H_M, 0,
    n[0], n[1], n[2], 0, c[0], c[1], c[2], 1]));
  gl.uniform2f(uni(prog, 'u_aspect'), W_M, H_M);
  gl.uniform2f(uni(prog, 'u_cursor'), hover ? hover.x / CW : -1, hover ? hover.y / CH : -1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(uni(prog, 'u_tex'), 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);               // premultiplied
  gl.bindVertexArray(vao);
  gl.uniform1i(uni(prog, 'u_mode'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (ray) {
    gl.uniform1i(uni(prog, 'u_mode'), 1);
    gl.uniform3fv(uni(prog, 'u_a'), ray.a);
    gl.uniform3fv(uni(prog, 'u_b'), ray.b);
    gl.drawArrays(gl.LINES, 0, 2);
  }
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

// for a desktop check of the board's layout
export function panelCanvas() { lastDrawn = ''; redraw(); return canvas; }
