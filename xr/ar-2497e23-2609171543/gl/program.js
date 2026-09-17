import { gl } from './context.js';

// the fragment stage of every pass that only wants depth or captured varyings
export const DEPTH_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }
`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src.trim());
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function link(vs, fs, beforeLink) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  if (beforeLink) beforeLink(p);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function program(vs, fs) {
  return link(vs, fs);
}
// program(), but with the varyings to capture declared before linking, which
// is the only point at which transform feedback can be configured.
export function programTF(vs, fs, varyings) {
  return link(vs, fs, p => gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS));
}
// A depth-only twin of a shading program: same vertex shader, an empty
// fragment shader, and its attributes pinned to the original's locations so
// the twin can draw straight from the original's VAOs. fs replaces the empty
// fragment stage when the depth pass must discard too.
export function depthTwin(vs, like, fs = DEPTH_FS) {
  return link(vs, fs, p => {
    const nAttr = gl.getProgramParameter(like, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < nAttr; i++) {
      const name = gl.getActiveAttrib(like, i).name;
      gl.bindAttribLocation(p, gl.getAttribLocation(like, name), name);
    }
  });
}
