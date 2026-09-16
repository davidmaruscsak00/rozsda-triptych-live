// ---- mat4 -------------------------------------------------------------
// index.html had no matrices at all: view was a mat3 and the projection was
// inlined per-shader assuming a centred frustum. A headset hands us a real
// off-axis projection per eye, so we compose properly. Column-major.
export function mul4(a, c) {                                    // returns a * c
  const o = new Float32Array(16);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[k * 4 + i] * c[j * 4 + k];
      o[j * 4 + i] = v;
    }
  return o;
}
export function invert4(m) {
  const t = m, o = new Float32Array(16);
  const a00=t[0],a01=t[1],a02=t[2],a03=t[3], a10=t[4],a11=t[5],a12=t[6],a13=t[7],
        a20=t[8],a21=t[9],a22=t[10],a23=t[11], a30=t[12],a31=t[13],a32=t[14],a33=t[15];
  const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
        b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
        b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
        b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
  let d = b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
  if (!d) return null;
  d = 1 / d;
  o[0]=(a11*b11-a12*b10+a13*b09)*d;  o[1]=(a02*b10-a01*b11-a03*b09)*d;
  o[2]=(a31*b05-a32*b04+a33*b03)*d;  o[3]=(a22*b04-a21*b05-a23*b03)*d;
  o[4]=(a12*b08-a10*b11-a13*b07)*d;  o[5]=(a00*b11-a02*b08+a03*b07)*d;
  o[6]=(a32*b02-a30*b05-a33*b01)*d;  o[7]=(a20*b05-a22*b02+a23*b01)*d;
  o[8]=(a10*b10-a11*b08+a13*b06)*d;  o[9]=(a01*b08-a00*b10-a03*b06)*d;
  o[10]=(a30*b04-a31*b02+a33*b00)*d; o[11]=(a21*b02-a20*b04-a23*b00)*d;
  o[12]=(a11*b07-a10*b09-a12*b06)*d; o[13]=(a00*b09-a01*b07+a02*b06)*d;
  o[14]=(a31*b01-a30*b03-a32*b00)*d; o[15]=(a20*b03-a21*b01+a22*b00)*d;
  return o;
}

export function xf4(m, x, y, z) {
  return [m[0]*x + m[4]*y + m[8]*z + m[12],
          m[1]*x + m[5]*y + m[9]*z + m[13],
          m[2]*x + m[6]*y + m[10]*z + m[14]];
}
