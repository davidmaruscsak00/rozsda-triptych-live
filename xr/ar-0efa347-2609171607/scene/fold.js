// The triptych fold on the CPU: a point on the unfolded sheet, carried into its
// panel. The wings hinge at x=0 and x=W and turn 45 degrees toward the viewer.
// Matches panelM / panelH in shaders/swirl.glsl.js.
import { IMG_W } from '../config.js';

export const SQ = Math.SQRT1_2;

// panel 0 centre, 1 left wing, 2 right wing
export function txPanel(p, panel) {
  if (panel === 1) return [SQ * p[0] - SQ * p[2], p[1], SQ * p[0] + SQ * p[2]];
  if (panel === 2) {
    const dx = p[0] - IMG_W;
    return [IMG_W + SQ * dx + SQ * p[2], p[1], -SQ * dx + SQ * p[2]];
  }
  return [p[0], p[1], p[2]];
}
