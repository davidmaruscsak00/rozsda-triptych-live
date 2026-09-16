// the real floor: nothing is drawn but darkness. Premultiplied black at the
// shadow's strength, so passthrough shows through everywhere else.
export const FLOOR_VS = `#version 300 es
uniform mat4 u_viewProj;
in vec3 a_p;
out vec3 v_w;
void main() {
  v_w = a_p;
  gl_Position = u_viewProj * vec4(a_p, 1.0);
}
`;

export const FLOOR_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
uniform sampler2DShadow u_shadow;
uniform mat4  u_lightVP;   // painting space -> light clip
uniform float u_texel;     // one shadow-map texel, in uv
uniform vec2  u_imgSize;
uniform vec2  u_frameZ;    // frame footprint: front, back (painting z)
uniform float u_frameW;    // frame rail width
uniform float u_strength;  // cast shadow darkness, 0..1
uniform float u_contact;   // contact shadow falloff, painting px
uniform float u_penumbra;  // penumbra growth, shadow texels per painting px
in vec3 v_w;
out vec4 outColor;

const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696,  0.457),
  vec2(-0.203,  0.621), vec2( 0.962, -0.195), vec2( 0.473, -0.480),
  vec2( 0.519,  0.767), vec2( 0.185, -0.893), vec2( 0.507,  0.064),
  vec2( 0.896,  0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));

// distance on the floor from a point to one panel's footprint rectangle, given
// in that panel's unfolded frame: x along the panel, z through its depth
float boxDist(vec2 q, float x0, float x1) {
  vec2 c = vec2(0.5 * (x0 + x1), 0.5 * (u_frameZ.x + u_frameZ.y));
  vec2 h = vec2(0.5 * (x1 - x0), 0.5 * (u_frameZ.y - u_frameZ.x));
  vec2 d = abs(q - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// a hash of a floor cell: rotates the sample disk per spot on the floor, so the
// banding turns into grain that stays put as the head moves
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // distance to the frame's footprint. Unfold the floor point into each
  // panel's frame (inverse of the 45-degree hinge rotations).
  float W = u_imgSize.x, S = 0.70710678;
  vec2 p = v_w.xz;
  vec2 qL = vec2(S * p.x + S * p.y, -S * p.x + S * p.y);
  vec2 qR = vec2(S * (p.x - W) - S * p.y + W, S * (p.x - W) + S * p.y);
  float d = max(min(boxDist(p, 0.0, W),
                min(boxDist(qL, -0.5 * W - u_frameW, 0.0), boxDist(qR, W, 1.5 * W + u_frameW))), 0.0);

  // cast shadow: the same fold-space light the chips are shaded by, only
  // steeper. A room light has area, so the penumbra opens up with distance
  // from whatever casts it; distance from the footprint stands in for that.
  vec4 lc = u_lightVP * vec4(v_w, 1.0);
  vec3 sc = lc.xyz / lc.w * 0.5 + 0.5;
  float rad = u_texel * (2.0 + d * u_penumbra);
  float ang = 6.2831853 * h21(floor(v_w.xz / 6.0));
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float lit = 0.0;
  for (int i = 0; i < 12; i++)
    lit += texture(u_shadow, vec3(sc.xy + rot * POISSON[i] * rad, min(sc.z - 0.0005, 1.0)));
  float shade = 1.0 - lit / 12.0;

  // contact shadow: the frame blocks the sky right where it stands, so the
  // floor darkens toward its footprint whatever the light is doing
  float contact = exp(-d / u_contact);

  float a = 1.0 - (1.0 - u_strength * shade) * (1.0 - 0.45 * contact);
  outColor = vec4(0.0, 0.0, 0.0, a);
}
`;
