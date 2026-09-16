export const canvas = document.getElementById('gl');
export const gl = canvas.getContext('webgl2', { antialias: true });
if (!gl) {
  document.body.innerHTML = '<p style="color:#ccc;font-family:sans-serif;padding:2em">WebGL2 not available.</p>';
  throw new Error('WebGL2 not available');
}
export const uni = (prog, n) => gl.getUniformLocation(prog, n);
