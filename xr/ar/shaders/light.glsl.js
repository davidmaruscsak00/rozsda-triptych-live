// The one light, as every lit shader reads it. Painting space, y down.
export const LIGHT = `
uniform vec3  u_lightDir;               // toward the light
uniform mat4  u_lightVP;                // painting space -> light clip
uniform highp sampler2DShadow u_shadow;
uniform float u_shadowTexel;

const vec3 LIGHT_COL = vec3(1.00, 0.96, 0.90);

// how much light reaches p: 1 lit .. 0 shadowed. Four taps on top of the
// hardware's bilinear comparison, for a soft edge.
float lightVis(vec3 p, float bias) {
  vec4 lc = u_lightVP * vec4(p, 1.0);
  vec3 sc = lc.xyz / lc.w * 0.5 + 0.5;
  if (sc.x < 0.0 || sc.y < 0.0 || sc.x > 1.0 || sc.y > 1.0) return 1.0;
  float r = u_shadowTexel * 1.25, z = min(sc.z - bias, 1.0);
  return 0.25 * (texture(u_shadow, vec3(sc.xy + vec2(-r, -r), z))
               + texture(u_shadow, vec3(sc.xy + vec2( r, -r), z))
               + texture(u_shadow, vec3(sc.xy + vec2(-r,  r), z))
               + texture(u_shadow, vec3(sc.xy + vec2( r,  r), z)));
}

// a cool sky from above and a warm bounce from below
vec3 hemiAmbient(vec3 N) {
  return mix(vec3(0.34, 0.30, 0.26), vec3(0.50, 0.53, 0.58), 0.5 - 0.5 * N.y);
}

// Painted surfaces: hemisphere ambient, diffuse with soft shadows, a faint
// varnish sheen. Exposed so that a resting front face in full light shows the
// paint's own colour, whichever way the light is turned.
vec3 shadePaint(vec3 albedo, vec3 N, vec3 V, float vis) {
  // a room is never pitch dark in a shadow: light bounces in, so shadows on
  // the paint read clearly without swallowing it
  vis = mix(0.3, 1.0, vis);
  vec3 frontN = vec3(0.0, 0.0, -1.0);
  float rest = max(dot(frontN, u_lightDir), 0.25);
  float diff = max(dot(N, u_lightDir), 0.0);
  vec3 amb = hemiAmbient(N) / (hemiAmbient(frontN).g + 1e-3) * 0.42;
  vec3 col = albedo * (amb + LIGHT_COL * (0.58 / rest) * diff * vis);
  vec3 H = normalize(u_lightDir + V);
  col += LIGHT_COL * pow(max(dot(N, H), 0.0), 70.0) * 0.10 * vis;
  return col;
}
`;
