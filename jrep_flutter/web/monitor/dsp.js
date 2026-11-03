// all2.py の VPG 解析（scipy / numpy 依存部分）をブラウザ向けに移植したもの。
// butter / filtfilt / np.gradient / rfft は scipy・numpy と同じ計算式で実装している。

// ---------------------------------------------------------------
// 複素数の最小実装
// ---------------------------------------------------------------
const C = (re, im = 0) => ({ re, im });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const csub = (a, b) => C(a.re - b.re, a.im - b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cscale = (a, s) => C(a.re * s, a.im * s);
const csqrt = (a) => {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return C(re, a.im < 0 ? -im : im);
};

// numpy.poly：根から多項式係数（実部のみ返す）
function polyFromRoots(roots) {
  let c = [C(1)];
  for (const r of roots) {
    const next = new Array(c.length + 1).fill(null).map(() => C(0));
    for (let i = 0; i < c.length; i++) {
      next[i] = cadd(next[i], c[i]);
      next[i + 1] = csub(next[i + 1], cmul(c[i], r));
    }
    c = next;
  }
  return c.map((x) => x.re);
}

// scipy.signal.butter(N, [lo, hi], btype='band')（Wn は Nyquist 正規化）
export function butterBandpass(N, lo, hi) {
  const fs = 2.0;
  const w1 = 2 * fs * Math.tan((Math.PI * lo) / fs);
  const w2 = 2 * fs * Math.tan((Math.PI * hi) / fs);
  const bw = w2 - w1;
  const wo = Math.sqrt(w1 * w2);
  // buttap
  const p = [];
  for (let m = -N + 1; m < N; m += 2) {
    const th = (Math.PI * m) / (2 * N);
    p.push(C(-Math.cos(th), -Math.sin(th)));
  }
  // lp2bp_zpk
  const pBp = [];
  const pLp = p.map((x) => cscale(x, bw / 2));
  for (const x of pLp) pBp.push(cadd(x, csqrt(csub(cmul(x, x), C(wo * wo)))));
  for (const x of pLp) pBp.push(csub(x, csqrt(csub(cmul(x, x), C(wo * wo)))));
  const zBp = new Array(N).fill(null).map(() => C(0));
  const kBp = Math.pow(bw, N);
  // bilinear_zpk
  const fs2 = C(2 * fs);
  const zZ = zBp.map((z) => cdiv(cadd(fs2, z), csub(fs2, z)));
  const pZ = pBp.map((x) => cdiv(cadd(fs2, x), csub(fs2, x)));
  for (let i = 0; i < pBp.length - zBp.length; i++) zZ.push(C(-1));
  let num = C(1);
  for (const z of zBp) num = cmul(num, csub(fs2, z));
  let den = C(1);
  for (const x of pBp) den = cmul(den, csub(fs2, x));
  const kZ = kBp * cdiv(num, den).re;
  const b = polyFromRoots(zZ).map((v) => v * kZ);
  const a = polyFromRoots(pZ);
  return { b, a };
}

// scipy.signal.lfilter（直接形 II 転置）
function lfilter(b, a, x, zi) {
  const n = a.length;
  const z = zi.slice();
  const y = new Float64Array(x.length);
  for (let k = 0; k < x.length; k++) {
    const xk = x[k];
    const yk = b[0] * xk + z[0];
    for (let i = 0; i < n - 2; i++) z[i] = b[i + 1] * xk + z[i + 1] - a[i + 1] * yk;
    z[n - 2] = b[n - 1] * xk - a[n - 1] * yk;
    y[k] = yk;
  }
  return y;
}

// scipy.signal.lfilter_zi
function lfilterZi(b, a) {
  const n = a.length;
  const m = n - 1;
  // IminusA = I - companion(a).T
  const M = [];
  for (let i = 0; i < m; i++) {
    M.push(new Float64Array(m));
    for (let j = 0; j < m; j++) {
      let comp = 0; // companion(a)[j][i]
      if (j === 0) comp = -a[i + 1] / a[0];
      else if (j === i + 1) comp = 1;
      M[i][j] = (i === j ? 1 : 0) - comp;
    }
  }
  const B = new Float64Array(m);
  for (let i = 0; i < m; i++) B[i] = b[i + 1] - a[i + 1] * b[0];
  // ガウスの消去法（部分ピボット）
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = c + 1; r < m; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < m; k++) M[r][k] -= f * M[c][k];
      B[r] -= f * B[c];
    }
  }
  const zi = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let s = B[r];
    for (let k = r + 1; k < m; k++) s -= M[r][k] * zi[k];
    zi[r] = s / M[r][r];
  }
  return Array.from(zi);
}

// scipy.signal.filtfilt（padtype='odd', padlen=3*max(len(a),len(b))）
export function filtfilt(b, a, x) {
  const padlen = 3 * Math.max(a.length, b.length);
  if (x.length <= padlen) throw new Error('signal too short for filtfilt');
  const n = x.length;
  const ext = new Float64Array(n + 2 * padlen);
  for (let i = 0; i < padlen; i++) ext[i] = 2 * x[0] - x[padlen - i];
  for (let i = 0; i < n; i++) ext[padlen + i] = x[i];
  for (let i = 0; i < padlen; i++) ext[padlen + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  const zi = lfilterZi(b, a);
  let y = lfilter(b, a, ext, zi.map((v) => v * ext[0]));
  y.reverse();
  y = lfilter(b, a, y, zi.map((v) => v * y[0]));
  y.reverse();
  return Array.from(y.subarray(padlen, padlen + n));
}

// numpy.gradient(y, t, edge_order=2)
function gradient(y, t) {
  const n = y.length;
  const g = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const d1 = t[i] - t[i - 1];
    const d2 = t[i + 1] - t[i];
    g[i] =
      (-d2 / (d1 * (d1 + d2))) * y[i - 1] +
      ((d2 - d1) / (d1 * d2)) * y[i] +
      (d1 / (d2 * (d1 + d2))) * y[i + 1];
  }
  {
    const d1 = t[1] - t[0];
    const d2 = t[2] - t[1];
    g[0] =
      (-(2 * d1 + d2) / (d1 * (d1 + d2))) * y[0] +
      ((d1 + d2) / (d1 * d2)) * y[1] +
      (-d1 / (d2 * (d1 + d2))) * y[2];
  }
  {
    const d1 = t[n - 2] - t[n - 3];
    const d2 = t[n - 1] - t[n - 2];
    g[n - 1] =
      (d2 / (d1 * (d1 + d2))) * y[n - 3] +
      (-(d2 + d1) / (d1 * d2)) * y[n - 2] +
      ((2 * d2 + d1) / (d2 * (d1 + d2))) * y[n - 1];
  }
  return g;
}

// ---------------------------------------------------------------
// all2.py: find_minima_times / first_two_extrema_on_dd / compute_all_cycles_features
// ---------------------------------------------------------------
function findMinimaIndices(g2) {
  const idx = [];
  for (let i = 0; i < g2.length - 2; i++) {
    if (g2[i + 1] - g2[i] < 0 && g2[i + 2] - g2[i + 1] >= 0 && g2[i + 1] < 0) idx.push(i + 1);
  }
  return idx;
}

function firstTwoExtremaOnDd(segT, segY) {
  const dd = gradient(gradient(segY, segT), segT);
  const maxIdx = [];
  const minIdx = [];
  for (let i = 0; i < dd.length - 2; i++) {
    if (dd[i + 1] - dd[i] > 0 && dd[i + 2] - dd[i + 1] <= 0) maxIdx.push(i + 1);
    if (dd[i + 1] - dd[i] < 0 && dd[i + 2] - dd[i + 1] >= 0) minIdx.push(i + 1);
  }
  const get = (lst, k) => (lst.length > k ? dd[lst[k]] : null);
  return { a: get(maxIdx, 0), b: get(minIdx, 0), d: get(minIdx, 1) };
}

export function computeAllCyclesFeatures(t, g2) {
  const minIdx = findMinimaIndices(g2);
  const results = [];
  for (let k = 0; k < minIdx.length - 1; k++) {
    const i0 = minIdx[k];
    const i1 = minIdx[k + 1];
    const T = t[i1] - t[i0];
    if (T <= 0) continue;
    const hrSeg = Math.trunc(60.0 / T);
    if (hrSeg < 40 || hrSeg > 200) continue;
    const segT = t.slice(i0, i1 + 1);
    const segY = g2.slice(i0, i1 + 1);
    if (segT.length < 5) continue;
    const { a, b, d } = firstTwoExtremaOnDd(segT, segY);
    let ratioBA = 0.0;
    let ratioDA = 0.0;
    if (a && Math.abs(a) > 1e-9) {
      ratioBA = (b || 0.0) / a;
      ratioDA = (d || 0.0) / a;
    }
    results.push({ hr: hrSeg, a_val: a, b_val: b, d_val: d, ratio_b_a: ratioBA, ratio_d_a: ratioDA });
  }
  return results;
}

// all2.py: _calc_hr_fft
export function calcHrFft(t, g) {
  const n = t.length;
  if (n < 30) return null;
  const tu = new Array(n);
  for (let i = 0; i < n; i++) tu[i] = t[0] + ((t[n - 1] - t[0]) * i) / (n - 1);
  // np.interp
  const gu = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = tu[i];
    while (j < n - 2 && t[j + 1] < x) j++;
    if (x <= t[0]) gu[i] = g[0];
    else if (x >= t[n - 1]) gu[i] = g[n - 1];
    else {
      const f = (x - t[j]) / (t[j + 1] - t[j]);
      gu[i] = g[j] + f * (g[j + 1] - g[j]);
    }
  }
  const mean = gu.reduce((s, v) => s + v, 0) / n;
  const w = gu.map((v, i) => (v - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
  const dt = tu[1] - tu[0];
  let best = null;
  let bestPow = -Infinity;
  for (let k = 0; k <= Math.floor(n / 2); k++) {
    const f = k / (n * dt);
    if (f < 45 / 60 || f > 200 / 60) continue;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const ang = (-2 * Math.PI * k * i) / n;
      re += w[i] * Math.cos(ang);
      im += w[i] * Math.sin(ang);
    }
    const pw = re * re + im * im;
    if (pw > bestPow) {
      bestPow = pw;
      best = f;
    }
  }
  return best === null ? null : best * 60.0;
}
