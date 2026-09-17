// the chip draw: a rigid transform of a template prism onto one record from
// the field pass, plus two dot products of lighting. Nothing else.
export const CHIPS_VS = `#version 300 es
uniform vec3  u_camPos;    // eye position, in painting space
uniform mat4  u_viewProj;  // eye projection * eye view * worldFromPainting
uniform float u_dimScale;  // 1 when shading; larger in the thinned shadow pass

in vec3 a_cv;             // template vertex: an irregular painting-piece prism
in vec3 a_cn;              // template normal
in vec4 a_A;               // per-instance, from the field pass
in vec4 a_B;
in vec4 a_C;
in vec4 a_D;

out vec3 v_col;

void main() {
  vec3 cen = a_A.xyz, fwd = a_B.xyz, side = a_C.xyz;
  vec3 up = cross(fwd, side);
  vec3 lp = a_cv * vec3(a_A.w * u_dimScale, a_B.w * u_dimScale, a_C.w);
  vec3 pw = cen + fwd * lp.x + side * lp.y + up * lp.z;
  vec3 N = normalize(a_cn.x * fwd + a_cn.y * side + a_cn.z * up);

  vec3 L = normalize(vec3(0.30, -0.45, -0.85));
  float diff = max(dot(N, L), 0.0);
  vec3 V = normalize(u_camPos - pw);
  vec3 H = normalize(L + V);
  float glint = pow(max(dot(N, H), 0.0), 42.0) * a_D.w;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.5) * 0.11;

  v_col = a_D.xyz * ((0.30 + 0.80 * diff) / (0.30 + 0.80 * 0.85))
        + vec3(1.00, 0.96, 0.88) * glint
        + vec3(0.55, 0.62, 0.78) * rim;
  gl_Position = u_viewProj * vec4(pw, 1.0);
}
`;

export const CHIPS_FS = `#version 300 es
precision highp float;
in vec3 v_col;
out vec4 outColor;
void main() { outColor = vec4(v_col, 1.0); }
`;
