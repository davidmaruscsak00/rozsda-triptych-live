// the hallucination flow field, shared by the particles and the joining pieces
export const SWIRL = `float hash11(float n) { return fract(sin(n) * 43758.5453123); }

// two octaves of curl-style turbulence: a divergence-free-looking 3D vector
// field that twists the flow into filaments
vec3 curlT(vec3 p, float t) {
  vec3 v = vec3(
    sin(p.y * 1.7 + t)       * cos(p.z * 1.3 - t * 0.7),
    sin(p.z * 1.9 - t * 0.8) * cos(p.x * 1.1 + t * 0.6),
    sin(p.x * 1.3 + t * 0.9) * cos(p.y * 1.7 - t * 0.5));
  v += 0.5 * vec3(
    sin(p.y * 3.9 - t * 1.3) * cos(p.x * 3.1 + t),
    sin(p.x * 4.3 + t * 1.1) * cos(p.z * 3.7 - t * 0.9),
    sin(p.z * 3.3 - t * 1.2) * cos(p.y * 4.1 + t * 0.8));
  return v;
}

// where the swirl bites into the painting: a slowly evolving spatial noise;
// regions where it runs low let go first, so the painting peels organically
// in patches instead of piece-by-piece at random
float activation(vec2 uv, float sep, float t, float jit) {
  vec2 p = uv * 6.28318;
  float n = clamp(0.5 + 0.34 * sin(p.x * 1.9 + t * 0.11) * sin(p.y * 1.6 - t * 0.09)
                      + 0.16 * sin(p.x * 3.4 + p.y * 2.9 - t * 0.07), 0.0, 1.0);
  return smoothstep(0.0, 0.85, sep * 1.9 - n * 0.95 - 0.05 * jit);
}

// broad, slow surface swell: wavelengths of half a painting, drifting gently;
// z is signed (negative = bulging out through the wall toward the viewer)
vec3 waveField(vec2 uv, float t) {
  vec2 p = uv * 6.28318;
  float z1 = sin(p.x * 0.55 + t * 0.17) * sin(p.y * 0.45 - t * 0.13 + 1.3);
  float z2 = sin(p.x * 1.05 - t * 0.11 + p.y * 0.75 + 4.1);
  vec2 xy = vec2(sin(p.y * 0.65 + t * 0.15 + 2.2), sin(p.x * 0.60 - t * 0.19 + 0.7));
  return vec3(xy * 150.0, -(0.6 * z1 + 0.4 * z2) * 340.0);
}

// the fully-awake state: deep churning folds CONTAINED in the painting's
// rectangle. The envelope E pins the frame edges, so the silhouette stays a
// rectangular relief; inside, ridges bulge out of the wall and slosh around.
vec3 boxField(vec2 uv, float t) {
  float su = 3.14159 * clamp((uv.x + 0.5) / 2.0, 0.0, 1.0);   // full triptych span
  float sv = 3.14159 * clamp(uv.y, 0.0, 1.0);
  float E = pow(max(sin(su) * sin(sv), 0.0), 0.45);
  vec2 p = uv * 6.28318;
  float z = 0.55 * sin(p.x * 0.9 + t * 0.16) * sin(p.y * 0.8 - t * 0.12 + 1.1)
          + 0.45 * sin(p.x * 1.7 - t * 0.10 + p.y * 1.2 + 3.6);
  vec2 xy = vec2(sin(su) * cos(sv), -cos(su) * sin(sv)) * sin(t * 0.13 + 1.0)
          + 0.6 * vec2(sin(su * 2.0) * cos(sv * 2.0), -cos(su * 2.0) * sin(sv * 2.0))
                * sin(t * 0.21 + 3.3);
  return vec3(xy * 230.0 * E, -(0.5 + 0.5 * z) * 560.0 * E);
}

// triptych fold: the work is computed on one flat "unfolded" sheet whose x
// runs from -W/2 (left wing tip) through [0,W] (center) to 3W/2 (right wing
// tip); the wings hinge at x=0 and x=W, angled 45 degrees toward the viewer
mat3 panelM(float ux, float W) {
  float C = 0.70710678;
  if (ux < 0.0) return mat3(vec3(C, 0.0, C),  vec3(0.0, 1.0, 0.0), vec3(-C, 0.0, C));
  if (ux > W)   return mat3(vec3(C, 0.0, -C), vec3(0.0, 1.0, 0.0), vec3(C, 0.0, C));
  return mat3(1.0);
}
vec3 panelH(float ux, float W) {
  return vec3(ux > W ? W : 0.0, 0.0, 0.0);
}

// a particle's position along the flow: a point in an ellipsoidal cloud,
// carried by differential rotation (inner orbits faster -> shear swirl),
// breathing in z, then twisted by curl turbulence. Velocity = d/dt of this.
vec3 flowPos(vec4 h, float t, float sep, float turb, vec2 center, vec2 imgSize) {
  vec3 dirn = normalize(vec3(h.x, h.y, h.z) - 0.5 + 1e-4);
  vec3 base = dirn * pow(h.w, 0.5);
  vec3 radii = vec3(0.62 * imgSize.x, 0.58 * imgSize.y, 270.0) * mix(0.9, 1.18, sep);
  float rr = clamp(length(base.xy), 0.0, 1.0);
  float om = mix(0.14, 0.045, rr) * (0.7 + 0.6 * h.w);
  float cs = cos(om * t), sn = sin(om * t);
  vec3 q = vec3(mat2(cs, -sn, sn, cs) * base.xy, base.z);
  q.z += 0.15 * sin(t * 0.14 + h.y * 6.28318);
  vec3 pos = vec3(center, mix(330.0, -90.0, sep)) + q * radii;
  pos += turb * mix(35.0, 90.0, h.z) * curlT(pos * 0.0042, t * 0.20);
  return pos;
}
`;
