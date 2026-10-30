/* SameLight core: runs entirely in the browser.
   Aligns two face photos, measures what skincare cannot change, and builds a fair pair. */
(() => {
  const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const EYE_L = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
  const EYE_R = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
  const BROW_L = [70,63,105,66,107,55,65,52,53,46];
  const BROW_R = [300,293,334,296,336,285,295,282,283,276];
  const LIPS = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
  const MIN_WIDTH = 560;    // Skin Analysis needs at least 480 px on the short side
  const FACE_SHARE = 0.7;   // and a face wider than 60% of the image
  const SHARP_TOLERANCE = 1.12;
  const BANDS = [0.8, 1.6];

  let landmarker;
  async function load() {
    if (landmarker) return landmarker;
    const { FilesetResolver, FaceLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
    landmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 2,
    });
    return landmarker;
  }

  function toCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.naturalWidth || src.width;
    c.height = src.naturalHeight || src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function faces(canvas) {
    const r = landmarker.detect(canvas);
    return r.faceLandmarks.map(f => f.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height })));
  }

  /* One screenshot holding both photos: cut halfway between the two faces. */
  function splitPair(canvas) {
    const found = faces(canvas);
    if (found.length !== 2) return null;
    const [a, b] = found.map(f => f[1]);
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    const part = (x, y, w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return c;
    };
    if (dx >= dy) {
      const cut = Math.round((a.x + b.x) / 2);
      return [part(0, 0, cut, canvas.height), part(cut, 0, canvas.width - cut, canvas.height)];
    }
    const cut = Math.round((a.y + b.y) / 2);
    return [part(0, 0, canvas.width, cut), part(0, cut, canvas.width, canvas.height - cut)];
  }

  const eyes = lm => ({ l: lm[33], r: lm[263] });
  const iod = lm => { const e = eyes(lm); return Math.hypot(e.r.x - e.l.x, e.r.y - e.l.y); };

  /* Width of the face, in eye distances. */
  const breadth = lm => Math.hypot(lm[454].x - lm[234].x, lm[454].y - lm[234].y) / iod(lm);

  /* Crop a face so the eye line is level and centred, at a chosen eye distance. */
  function frame(canvas, lm, eyeDist, wide) {
    const e = eyes(lm);
    const w = Math.round(eyeDist * wide / FACE_SHARE);
    const zoom = Math.max(1, MIN_WIDTH / w);
    const W = Math.round(w * zoom), H = Math.round(W * 1.3);
    const s = (eyeDist * zoom) / iod(lm);
    const angle = -Math.atan2(e.r.y - e.l.y, e.r.x - e.l.x);
    const mx = (e.l.x + e.r.x) / 2, my = (e.l.y + e.r.y) / 2;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H * 0.42);
    ctx.rotate(angle);
    ctx.scale(s, s);
    ctx.translate(-mx, -my);
    ctx.drawImage(canvas, 0, 0);
    const c = Math.cos(angle), n = Math.sin(angle);
    const map = p => {
      const x = (p.x - mx) * s, y = (p.y - my) * s;
      return { x: x * c - y * n + W / 2, y: x * n + y * c + H * 0.42 };
    };
    return { canvas: out, lm: lm.map(map), w: W, h: H };
  }

  function planes(canvas) {
    const { width: w, height: h } = canvas;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const n = w * h, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) { r[i] = px[i * 4]; g[i] = px[i * 4 + 1]; b[i] = px[i * 4 + 2]; }
    return { r, g, b, w, h };
  }

  const luma = p => {
    const L = new Float32Array(p.r.length);
    for (let i = 0; i < L.length; i++) L[i] = 0.299 * p.r[i] + 0.587 * p.g[i] + 0.114 * p.b[i];
    return L;
  };

  function gauss(src, w, h, sigma) {
    if (sigma <= 0.01) return src;
    const rad = Math.ceil(sigma * 3), k = new Float32Array(rad * 2 + 1);
    let sum = 0;
    for (let i = -rad; i <= rad; i++) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + rad]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -rad; i <= rad; i++) v += k[i + rad] * src[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -rad; i <= rad; i++) v += k[i + rad] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = v;
    }
    return out;
  }

  function polyMask(w, h, polys, grow = 0) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = x.strokeStyle = '#fff';
    x.lineWidth = grow * 2;
    x.lineJoin = 'round';
    for (const p of polys) {
      x.beginPath();
      p.forEach((q, i) => i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y));
      x.closePath();
      x.fill();
      if (grow) x.stroke();
    }
    const d = x.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
    return m;
  }

  /* Detail energy in one frequency band, only where skincare has no effect. */
  function detail(L, w, h, mask, band) {
    const a = gauss(L, w, h, band), b = gauss(L, w, h, band * 2);
    let s = 0, n = 0;
    for (let i = 0; i < L.length; i++) if (mask[i]) { const d = a[i] - b[i]; s += d * d; n++; }
    return s / Math.max(1, n);
  }

  function matchSharpness(L, w, h, mask, band, target) {
    let lo = 0, hi = 6;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (detail(gauss(L, w, h, mid), w, h, mask, band) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* The sharpness search repeats many blurs, so it only runs on the box around the mask. */
  function cropToMask(layers, mask, w, h) {
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    x0 = Math.max(0, x0 - 24); y0 = Math.max(0, y0 - 24);
    const cw = Math.min(w, x1 + 25) - x0, ch = Math.min(h, y1 + 25) - y0;
    const cut = src => {
      const out = new src.constructor(cw * ch);
      for (let y = 0; y < ch; y++) out.set(src.subarray((y + y0) * w + x0, (y + y0) * w + x0 + cw), y * cw);
      return out;
    };
    return [cw, ch, ...layers.map(cut), cut(mask)];
  }

  /* Eyes and brows do not brighten with skincare, so they carry the camera's exposure and colour. */
  function lightGains(pB, pA, mask) {
    return ['r', 'g', 'b'].map(k => {
      let sb = 0, sa = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] && pB[k][i] < 250 && pA[k][i] < 250) { sb += pB[k][i]; sa += pA[k][i]; }
      return sb / Math.max(1, sa);
    });
  }

  function paint(p, sigma, ceiling = [255, 255, 255]) {
    const c = document.createElement('canvas');
    c.width = p.w; c.height = p.h;
    const x = c.getContext('2d'), img = x.createImageData(p.w, p.h);
    const ch = [p.r, p.g, p.b].map(v => gauss(v, p.w, p.h, sigma));
    for (let i = 0; i < p.w * p.h; i++) {
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(ceiling[k], ch[k][i]);
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  const blob = c => new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));

  async function prepare(beforeCanvas, afterCanvas) {
    await load();
    const fb = faces(beforeCanvas)[0], fa = faces(afterCanvas)[0];
    if (!fb || !fa) throw new Error(`No face found in the ${!fb ? 'before' : 'after'} photo.`);
    const ib = iod(fb), ia = iod(fa), shared = Math.min(ib, ia);

    const wide = Math.max(breadth(fb), breadth(fa));
    const shownB = frame(beforeCanvas, fb, ib, breadth(fb)), shownA = frame(afterCanvas, fa, ia, breadth(fa));
    const B = frame(beforeCanvas, fb, shared, wide), A = frame(afterCanvas, fa, shared, wide);
    const w = B.w, h = B.h, pB = planes(B.canvas), pA = planes(A.canvas);

    const pick = (lm, ids) => ids.map(i => lm[i]);
    const unit = w / 30;
    const browsAndEyes = lm => [pick(lm, EYE_L), pick(lm, EYE_R), pick(lm, BROW_L), pick(lm, BROW_R)];
    const fixed = polyMask(w, h, [...browsAndEyes(B.lm), ...browsAndEyes(A.lm), pick(B.lm, LIPS), pick(A.lm, LIPS)], unit);
    const stable = polyMask(w, h, [...browsAndEyes(B.lm), ...browsAndEyes(A.lm)], 2);

    // Exposure comes first: a brightened photo has inflated contrast and would look sharper than it is.
    let gains = lightGains(pB, pA, stable);
    const logs = gains.map(Math.log);
    const sceneChanged = Math.max(...logs.map(Math.abs)) > 0.7 || Math.abs(logs[0] - logs[2]) > 0.4;
    if (sceneChanged) gains = [1, 1, 1];
    const gA = { ...pA, r: pA.r.map(v => v * gains[0]), g: pA.g.map(v => v * gains[1]), b: pA.b.map(v => v * gains[2]) };

    const [cw, ch, LB, LA, keep] = cropToMask([luma(pB), luma(gA)], fixed, w, h);
    const eB = BANDS.map(b => detail(LB, cw, ch, keep, b)), eA = BANDS.map(b => detail(LA, cw, ch, keep, b));
    const softer = eA[0] < eB[0] ? 'after' : 'before';
    const ratio = Math.max(eA[0], eB[0]) / Math.max(1e-6, Math.min(eA[0], eB[0]));
    let sigmaB = 0, sigmaA = 0;
    if (ratio > SHARP_TOLERANCE) {
      const [L, target] = softer === 'after' ? [LB, eA] : [LA, eB];
      const sigma = Math.max(...BANDS.map((b, i) => matchSharpness(L, cw, ch, keep, b, target[i])));
      if (softer === 'after') sigmaB = sigma; else sigmaA = sigma;
    }

    // Highlights blown out in the brighter photo are gone for good, so remove them from the other one too.
    const fairB = paint(pB, sigmaB, gains.map(g => 255 * Math.min(1, g)));
    const fairA = paint(gA, sigmaA);
    const yaw = lm => (lm[1].x - (lm[33].x + lm[263].x) / 2) / iod(lm);

    return {
      shownBefore: shownB.canvas, shownAfter: shownA.canvas, fairBefore: fairB, fairAfter: fairA,
      blobs: {
        shownBefore: await blob(shownB.canvas), shownAfter: await blob(shownA.canvas),
        fairBefore: await blob(fairB), fairAfter: await blob(fairA),
      },
      facts: {
        softer: ratio > SHARP_TOLERANCE ? softer : 'neither',
        softnessRatio: Math.sqrt(ratio),
        sigma: Math.max(sigmaA, sigmaB),
        exposure: 1 / (gains.reduce((a, b) => a + b) / 3) - 1,
        warmth: Math.log(gains[2] / gains[0]),
        sceneChanged,
        scale: ia / ib,
        turn: Math.abs(yaw(fa) - yaw(fb)),
      },
    };
  }

  const LABELS = { pore: 'Pores', texture: 'Texture', wrinkle: 'Wrinkles', age_spot: 'Dark spots', acne: 'Acne marks', radiance: 'Radiance' };

  /* Scores: higher means healthier skin. A claim only counts when it is an improvement. */
  function verdict(shownBefore, shownAfter, fairBefore, fairAfter) {
    const rows = Object.keys(LABELS).filter(k => k in shownBefore).map(k => {
      const shown = shownAfter[k] - shownBefore[k], fair = fairAfter[k] - fairBefore[k];
      return { key: k, label: LABELS[k], shown, fair, kept: Math.min(Math.max(shown, 0), Math.max(fair, 0)) };
    });
    const claimed = rows.reduce((s, r) => s + Math.max(r.shown, 0), 0);
    const kept = rows.reduce((s, r) => s + r.kept, 0);
    const share = claimed > 0 ? kept / claimed : 0;
    const band = claimed < 6 ? 'none' : share < 0.35 ? 'camera' : share < 0.7 ? 'partly' : 'skin';
    return { rows, claimed, kept, share, band };
  }

  window.SameLight = { load, toCanvas, splitPair, prepare, verdict, LABELS };
})();
