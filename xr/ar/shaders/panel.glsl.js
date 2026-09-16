// The in-headset control panel: a textured quad in world space, and the
// pointing ray, drawn by one small program (u_mode 0 panel, 1 ray).
export const PANEL_VS = `#version 300 es
uniform mat4 u_viewProj;   // eye projection * eye view (world, metres)
uniform mat4 u_model;      // panel: right * width, up * height, normal, centre
uniform int  u_mode;
uniform vec3 u_a, u_b;     // ray endpoints
in vec2 a_pos;             // panel corner in [-0.5, 0.5]; ray end in x (0 or 1)
out vec2 v_uv;
void main() {
  vec3 p;
  if (u_mode == 0) {
    p = (u_model * vec4(a_pos, 0.0, 1.0)).xyz;
    v_uv = vec2(a_pos.x + 0.5, 0.5 - a_pos.y);
  } else {
    p = mix(u_a, u_b, a_pos.x + 0.5);
    v_uv = vec2(a_pos.x + 0.5, 0.0);
  }
  gl_Position = u_viewProj * vec4(p, 1.0);
}
`;

export const PANEL_FS = `#version 300 es
precision highp float;
precision highp int;          // must match the vertex stage for u_mode
uniform sampler2D u_tex;   // premultiplied
uniform int  u_mode;
uniform vec2 u_cursor;     // uv of the ray's hit, or negative
uniform vec2 u_aspect;     // panel width, height in metres
in vec2 v_uv;
out vec4 outColor;
void main() {
  if (u_mode == 1) {                                  // the ray fades out along its length
    float a = 0.85 * (1.0 - v_uv.x * 0.8);
    outColor = vec4(vec3(1.0, 0.86, 0.55) * a, a);
    return;
  }
  vec4 c = texture(u_tex, v_uv);
  if (u_cursor.x >= 0.0) {
    vec2 d = (v_uv - u_cursor) * u_aspect;
    float r = length(d);
    float dot_ = 1.0 - smoothstep(0.004, 0.006, r);
    float ring = (1.0 - smoothstep(0.009, 0.011, r)) * smoothstep(0.006, 0.008, r);
    c = mix(c, vec4(1.0, 0.86, 0.55, 1.0), max(dot_, ring * 0.8));
  }
  outColor = c;
}
`;
