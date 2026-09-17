import { invert4 } from '../gl/mat4.js';
import { qp, IMG_W, IMG_H, FLOOR_Y } from '../config.js';

// ---- painting space -> the real room -------------------------------------
// The piece is authored in painting pixels with y pointing down and the wall
// at z=0. XR wants metres, y up, and the real floor at y=0 of local-floor.
// One matrix carries the convention change and the placement, so every
// field, fold and collision test upstream is left exactly as index.html had
// it. The pivot is the foot of the centre panel: where you put it down is
// where that panel stands, facing you.
export const place = {
  x: 0, z: 0,
  face: 0,                                  // yaw that turns the front to the viewer
  turn: 0,                                  // extra yaw from the left stick
  height: parseFloat(qp.get('scale') || '2.6'),   // triptych height, m
  carrying: false, placed: false,
  carrier: null,                            // the input source whose ray moves it, or null for any
};
// the wings reach about 1.15 m toward you at this size, so their tips land
// about 0.85 m away; the board's Move, Turn, Size and Distance rows go from there
export const BACK_M = parseFloat(qp.get('back') || '2.0');     // first drop, metres ahead
export let worldFromPainting = null, paintingFromWorld = null;
export function updatePlacement() {
  const MPP = place.height / IMG_H;                        // metres per pixel
  const yaw = place.face + place.turn;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  worldFromPainting = new Float32Array([
    MPP * c, 0, -MPP * s, 0,
    0, -MPP, 0, 0,
    -MPP * s, 0, -MPP * c, 0,
    -c * MPP * IMG_W / 2 + place.x, MPP * FLOOR_Y, s * MPP * IMG_W / 2 + place.z, 1,
  ]);
  paintingFromWorld = invert4(worldFromPainting);
}
updatePlacement();
export function faceViewer(hp) {
  place.face = Math.atan2(hp.x - place.x, hp.z - place.z);
}
