// What a frame draws, in order, for the shadow map and for each eye.
import { gl } from '../gl/context.js';
import { paintTex } from './paint.js';
import { drawFrame } from './frame.js';
import { drawPieces } from './pieces.js';
import { drawCanvas } from './canvas.js';
import { drawChips } from './chips.js';
import { updateParticles, drawParticles } from './particles.js';
import { runXform } from './xform.js';
import { stepFluid } from './fluid.js';
import { setLight } from './light.js';
import { runFieldPass } from './chips.js';
import { renderShadowMap, drawFloor } from './shadow.js';
import { piecesEl } from '../ui.js';
import { SHADOW_RES } from '../config.js';

gl.enable(gl.DEPTH_TEST);

// ---- the installation --------------------------------------------------
// Frame, pieces, their particles (and the legacy chips with ?chips=1), drawn
// either shaded into an eye or depth-only into the shadow map. The depth passes
// run the identical vertex shaders, so the shadow can never drift from what the
// eye sees. vpH is the target's height in px, for particle size.
function drawInstallation(viewProj, cp, st, depth, vpH) {
  drawFrame(viewProj, cp, depth);
  if (piecesEl.checked) {
    drawPieces(viewProj, cp, st, depth);
    if (!depth) drawCanvas(viewProj, cp, st);
    drawParticles(viewProj, cp, st, depth, vpH);
  }
  drawChips(viewProj, cp, depth);
}

// ---- simulation, once per frame, before any drawing ---------------------
export function update(st) {
  setLight(st.light);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, paintTex);
  runFieldPass(st);
  runXform(st);
  if (piecesEl.checked) { stepFluid(st); updateParticles(st); }
}

// ---- the shadow map, once per frame --------------------------------------
export function runShadowPass(st) {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, paintTex);
  renderShadowMap(lightVP => drawInstallation(lightVP, [0, 0, 0], st, true, SHADOW_RES));
}

// ---- the scene, once per eye -------------------------------------------
// cp is the eye position in painting space, which is what the specular and
// rim terms want. The caller owns the framebuffer, the clear and the viewport.
export function drawScene(viewProj, cp, st, vpH) {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, paintTex);
  drawInstallation(viewProj, cp, st, false, vpH);
  drawFloor(viewProj);
}
