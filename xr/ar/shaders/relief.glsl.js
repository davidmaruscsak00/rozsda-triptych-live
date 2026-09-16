// The Judit facade in the centre panel (scene/relief.js): how far the surface
// stands out toward the viewer at a spot of the unfolded sheet, in painting px,
// already scaled by the Form slider. Zero everywhere outside the face, so the
// wings are never touched.
export const RELIEF = `
uniform highp sampler2D u_relief;
uniform vec4  u_reliefRect;           // x, y, w, h on the sheet, painting px
uniform float u_form;                 // smoothed Form slider

float reliefH(vec2 q) {
  vec2 uv = (q - u_reliefRect.xy) / u_reliefRect.zw;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  return texture(u_relief, uv).r * u_form;
}
// slope of the height, per painting px
vec2 reliefGrad(vec2 q) {
  const float e = 5.0;
  return vec2(reliefH(q + vec2(e, 0.0)) - reliefH(q - vec2(e, 0.0)),
              reliefH(q + vec2(0.0, e)) - reliefH(q - vec2(0.0, e))) / (2.0 * e);
}
`;
