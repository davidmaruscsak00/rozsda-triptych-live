// URL parameters and the dimensions more than one module needs. Asset data
// arrives as globals from the classic scripts in ar.html (see window.ASSETS).
export const qp = new URLSearchParams(location.search);
export const { IMG_W, IMG_H, PIECES, PAINTING_DATA_URI } = window.ASSETS;

// Tunable at runtime so the field can be sized against a real headset without
// a rebuild: ?n= chips over the sheet, ?wedge= fillers behind the hinges.
export const N_MAIN = Math.max(0, parseInt(qp.get('n') || '300000', 10));
export const N_WEDGE = Math.max(0, parseInt(qp.get('wedge') || '24000', 10));
export const N_PARTICLES = N_MAIN + N_WEDGE;
// Particles the painting breaks into, over the base painting; the mirrored
// wings add about as many again. ?particles= (the Quality menu sets it).
// 2.4M suits a desktop GPU; a standalone headset starts far lower.
export const ON_HEADSET = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
export const N_POINTS = Math.max(0, parseInt(qp.get('particles') || (ON_HEADSET ? '150000' : '2400000'), 10));

// The chip field in the depth behind the painting is off by default; ?chips=1
// brings it back.
export const SHOW_CHIPS = qp.get('chips') === '1';

// the frame box, in painting pixels: the chips and pieces collide with it, the
// shadow and the floor are sized from it
export const FRAME_Z_FRONT = -170, FRAME_Z_BACK = 240;
export const FW = 70;                   // rail width
export const FLOOR_Y = IMG_H + 70;      // the bottom rail stands on the floor

export const SHADOW_RES = parseInt(qp.get('shadowres') || '2048', 10);
// The shadow draw is a second full geometry pass, and geometry is the wall,
// so it draws a thinned subset of chips, enlarged to keep the same coverage.
export const SHADOW_FRAC = Math.min(1, Math.max(0, parseFloat(qp.get('shadow') || '0.25')));
export const SUN_ELEV = parseFloat(qp.get('sun') || '60') * Math.PI / 180;
