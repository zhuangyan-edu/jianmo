(() => {
  let m; pivot.traverse(o => { if (o.isMesh) m = o; });
  const g = m.geometry, P = g.attributes.position, U = g.attributes.uv, N = g.attributes.normal;
  const img = m.material.map.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
  const flipY = m.material.map.flipY;
  const eye = [], skin = [];
  for (let i = 0; i < P.count; i++) {
    const u = U.getX(i), v = U.getY(i); const px = Math.min(c.width - 1, Math.max(0, Math.floor(u * c.width))), py = Math.min(c.height - 1, Math.max(0, Math.floor((flipY ? 1 - v : v) * c.height)));
    const k = (py * c.width + px) * 4, r = d[k], gg = d[k + 1], b = d[k + 2];
    const p = [P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i)];
    if (b > 170 && b > r + 25 && gg > r) eye.push(p);
    else if (r > 150 && r > b + 15 && r > gg + 10) skin.push(p);
  }
  // split eye verts into two clusters with 2-means
  let a = eye[0], bb = eye.reduce((q, p) => (Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) > Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]) ? p : q), a);
  let A = a.slice(0, 3), B = bb.slice(0, 3), ca, cb;
  for (let it = 0; it < 10; it++) {
    ca = [0, 0, 0, 0]; cb = [0, 0, 0, 0];
    for (const p of eye) { const da = Math.hypot(p[0] - A[0], p[1] - A[1], p[2] - A[2]), db = Math.hypot(p[0] - B[0], p[1] - B[1], p[2] - B[2]); const t = da < db ? ca : cb; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++; }
    A = ca.slice(0, 3).map(v => v / ca[3]); B = cb.slice(0, 3).map(v => v / cb[3]);
  }
  const mid = A.map((v, i) => (v + B[i]) / 2);
  const fwd = [0, 0, 0]; let n = 0;
  for (const p of skin) if (Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) < 0.12) { fwd[0] += p[3]; fwd[1] += p[4]; fwd[2] += p[5]; n++; }
  const sk = [0, 0, 0]; skin.forEach(p => { sk[0] += p[0]; sk[1] += p[1]; sk[2] += p[2]; });
  const smin = [1e9, 1e9, 1e9], smax = [-1e9, -1e9, -1e9]; skin.forEach(p => { for (let i = 0; i < 3; i++) { smin[i] = Math.min(smin[i], p[i]); smax[i] = Math.max(smax[i], p[i]); } });
  return JSON.stringify({ eyes: eye.length, na: ca[3], nb: cb[3], A, B, mid, fwd: fwd.map(v => v / n), n, skin: skin.length, skinC: sk.map(v => v / skin.length), smin, smax });
})()
