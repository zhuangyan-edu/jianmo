// Procedural hair grown on a scanned head.
//
// Everything is computed in "upright head space": origin between the eyes, x = character's left,
// y = up, z = forward, one unit = the distance between the eyes. `frame` converts that space back
// to the scan's own coordinates, so the result can simply be parented next to the head mesh.
//
// Roots are sampled on the scalp triangles of the head mesh. Each lock is a tapered, flattened tube
// that starts along the scalp (flowing away from the crown), then falls under gravity, gets pushed
// by a side wind and is kept outside an ellipsoid that approximates the skull.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const HAIR_DEFAULTS = {
  seed: 7,
  clumps: 150,          // guide strands; each one carries a bundle of locks
  clumpSpacing: 0.24,   // minimum distance between guide roots (eye-gap units)
  strays: 1,           // thin stray hairs per lock
  wild: 0.1,           // share of locks blown out by the wind
  skull: { c: [0, 0.55, -1.17], r: [1.3, 1.62, 1.5] },   // measured on assets/bald.glb
  crown: [0.12, 2.1, -1.45],
  wind: [-0.85, 0.12, -0.5],    // blows toward the character's right and back
  windStrength: 0.07,
  gravity: 0.17,
  color: [0.024, 0.019, 0.023],      // linear RGB
};

// Is this upright-space point on the part of the head that grows hair?
export function onScalp(x, y, z) {
  if (y > 1.38) return z < 0.12 || y > 1.5;                    // top of the head, behind the forehead hairline
  const temple = -0.25 - (1.38 - y) * 0.62;                    // hairline runs back and down toward the ear
  if (z > temple) return false;
  return y > (z > -1.55 ? 0.42 : -0.62);                       // stop above the ear, lower at the nape
}

export function buildHair(THREE, headMesh, frame, options = {}) {
  const o = { ...HAIR_DEFAULTS, ...options }, R = rng(o.seed);
  const { mid, left, up, f, gap } = frame;
  const toUpright = v => { const d = v.clone().sub(mid); return new THREE.Vector3(d.dot(left), d.dot(up), d.dot(f)).divideScalar(gap); };
  const toScan = (p, out) => out.copy(mid).addScaledVector(left, p.x * gap).addScaledVector(up, p.y * gap).addScaledVector(f, p.z * gap);
  const C = new THREE.Vector3(...o.skull.c), RAD = new THREE.Vector3(...o.skull.r), CROWN = new THREE.Vector3(...o.crown);
  const WIND = new THREE.Vector3(...o.wind).normalize();

  // ---- scalp triangles: used for root sampling and for the dark under-cap
  const P = headMesh.geometry.attributes.position, idx = headMesh.geometry.index.array;
  const U = new Array(P.count), tmp = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) U[i] = toUpright(tmp.fromBufferAttribute(P, i));
  const tris = [], cum = []; let area = 0;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    const a = U[idx[i]], b = U[idx[i + 1]], c = U[idx[i + 2]];
    if (!onScalp((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)) continue;
    area += e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2; tris.push(i); cum.push(area);
  }
  const pickRoot = () => {
    const t = R() * area; let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; cum[m] < t ? lo = m + 1 : hi = m; }
    const i = tris[lo], a = U[idx[i]], b = U[idx[i + 1]], c = U[idx[i + 2]];
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    return new THREE.Vector3().copy(a).addScaledVector(e1.subVectors(b, a), u).addScaledVector(e2.subVectors(c, a), v);
  };
  const outward = p => new THREE.Vector3().subVectors(p, C).divide(RAD).divide(RAD).normalize();   // ellipsoid normal

  // ---- grow one strand, returns its centre line
  function grow(root, k) {
    const n = outward(root), az = Math.atan2(root.x, root.z - C.z);            // 0 = front, ±π = back
    const front = Math.max(0, 1 - Math.abs(az) / 1.0), back = Math.max(0, (Math.abs(az) - 1.9) / 1.2);
    // where the strand stops: fringe at eye level (a few reach the nose), sides at the jaw, back at the nape
    let endY = front > 0 ? 0.6 - R() * 0.5 - (R() < 0.18 ? 0.6 : 0) : root.y - 1.75 - R() * 0.6 - back * 0.2;     // tiers: higher roots end higher
    if (k.wisp) endY += 0.35;
    const flow = new THREE.Vector3().subVectors(root, CROWN); flow.addScaledVector(n, -flow.dot(n)).normalize();
    // swirl the flow a little so the parting is not a perfect star
    flow.applyAxisAngle(n, (R() - 0.5) * 0.9 + 0.25);
    const d = flow.clone().addScaledVector(n, 0.04 + k.lift * 1.5).normalize();
    const step = 0.13, pts = [root.clone()], p = root.clone();
    const l0 = new THREE.Vector3().subVectors(root, C).divide(RAD).length();                // the real scalp is not exactly the ellipsoid
    const l1 = 1.05 + k.lift * 2.5 + 0.06 * Math.min(1, Math.max(0, (root.y - 0.4) / 1.7));       // higher roots lie on top
    const flick = (R() < 0.75 ? 1 : 0.2) * (0.1 + R() * 0.14) * (front > 0 ? 0.3 : 1);                                 // some tips kick outward
    const windK = o.windStrength * k.wind, ph1 = R() * 6.28, ph2 = R() * 6.28, curl = k.curl, fr = 0.55 + R() * 0.9;
    const side = new THREE.Vector3();
    for (let s = 1; s <= 34; s++) {
      const t = s / 20, lift = l0 + (l1 - l0) * Math.min(1, s / 7);
      side.crossVectors(d, outward(p)).normalize();
      d.y -= o.gravity * (k.wisp ? 0.6 : 1);
      d.addScaledVector(WIND, windK * t * t);
      d.addScaledVector(side, Math.sin(s * 0.55 * fr + ph1) * curl);
      d.addScaledVector(outward(p), Math.sin(s * 0.4 * fr + ph2) * curl * 0.6);
      if (p.y < endY + 0.5) { d.addScaledVector(outward(p), flick); d.y += flick * 0.55; }
      d.normalize();
      const prev = p.clone(); p.addScaledVector(d, step);
      const q = new THREE.Vector3().subVectors(p, C).divide(RAD), l = q.length();
      if (l < lift) { q.multiplyScalar(lift / l).multiply(RAD); p.copy(C).add(q); d.subVectors(p, prev).normalize(); }
      pts.push(p.clone());
      if (p.y < endY && s > 5) break;
    }
    return pts;
  }

  // ---- turn centre lines into tapered tubes
  const pos = [], nor = [], col = [], aT = [], aSeed = [], index = [];
  const sp = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), q = new THREE.Vector3(), nn = new THREE.Vector3();
  function tube(pts, radius, flat, sides, shade, seed) {
    const base = pos.length / 3, n = pts.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      N.copy(outward(pts[i])); B.crossVectors(T, N).normalize(); N.crossVectors(B, T).normalize();
      const r = radius * Math.min(1, 0.45 + t * 4) * (t < 0.5 ? 1 : Math.pow(Math.max(0, 1 - (t - 0.5) / 0.5), 0.85));   // full width, then a long pointed tip
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2, cb = Math.cos(a), cn = Math.sin(a);
        q.copy(pts[i]).addScaledVector(B, cb * r).addScaledVector(N, cn * r * flat);
        toScan(q, sp); pos.push(sp.x, sp.y, sp.z);
        nn.set(0, 0, 0).addScaledVector(B, cb * flat).addScaledVector(N, cn);
        sp.set(0, 0, 0).addScaledVector(left, nn.x).addScaledVector(up, nn.y).addScaledVector(f, nn.z).normalize(); nor.push(sp.x, sp.y, sp.z);
        const v = shade * (0.55 + 0.6 * Math.min(1, t * 2.5)) * (0.85 + 0.3 * (cn > 0 ? 1 : 0.4));   // darker at the root and underneath
        col.push(o.color[0] * v, o.color[1] * v, o.color[2] * v); aT.push(t); aSeed.push(seed);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * sides + j, b = base + i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      index.push(a, c, b, b, c, d);
    }
  }
  // ---- locks. Structure copied from the wig model the user generated (see README):
  //   * hair near the scalp is one smooth shell; separate locks only show in the lower part
  //   * a lock is a broad, flat ribbon, not a round strand
  //   * each lock splits into two or three pointed tips of different lengths
  //   * locks are layered like roof tiles: the higher the root, the higher the lock ends
  //   * tips hook outward
  const guides = [];
  for (let tries = 0; guides.length < o.clumps && tries < 40000; tries++) {
    const r = pickRoot();
    if (r.distanceTo(CROWN) < 0.3) continue;                                       // the shell covers the whorl itself
    if (guides.every(gd => gd.root.distanceToSquared(r) > o.clumpSpacing * o.clumpSpacing)) guides.push({ root: r });
  }
  const clampOut = (p, lift) => { const e = q.subVectors(p, C).divide(RAD), l = e.length(); if (l < lift) p.copy(C).add(e.multiplyScalar(lift / l).multiply(RAD)); return p; };
  for (const gd of guides) {
    const wild = R() < o.wild;                                                     // some locks get caught by the wind
    const k = { lift: R() * 0.025 + (wild ? 0.03 : 0), wind: wild ? 2.0 + R() * 1.6 : 0.25 + R() * 0.7, curl: 0.025 + R() * 0.04 };
    const path = grow(gd.root, k), n = path.length, shade = 0.7 + R() * 0.6;
    const width = 0.11 + R() * 0.07, subs = R() < 0.3 ? 2 : 3, l0 = new THREE.Vector3().subVectors(gd.root, C).divide(RAD).length();
    for (let m = 0; m < subs + o.strays; m++) {
      const stray = m >= subs, side = stray ? (R() - 0.5) * 3 : (m - (subs - 1) / 2) * 1.25;   // position across the lock, in widths
      const len = Math.max(5, Math.round(n * (stray ? 0.75 + R() * 0.35 : 0.8 + R() * 0.2)));
      const ph = R() * 6.28, amp = stray ? 0.1 * (0.5 + R()) : 0.012, pts = [];
      for (let i = 0; i < Math.min(len, n); i++) {
        const t = i / (n - 1), out = outward(path[i]);
        T.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
        B.crossVectors(T, out).normalize();
        const spread = stray ? 1 + t * 2 : 1 + Math.max(0, t - 0.55) * 1.6;        // sub-locks lie side by side, then part at the tip
        const pnt = path[i].clone().addScaledVector(B, side * width * spread + Math.sin(i * 0.45 + ph) * amp * t * 3);
        pnt.addScaledVector(out, (stray ? 0.03 + Math.cos(i * 0.5 + ph) * amp * t * 2 : -Math.abs(side) * 0.012));
        pts.push(clampOut(pnt, l0 + (1.03 - l0) * Math.min(1, i / 7)));
      }
      if (stray) tube(pts, 0.011 + R() * 0.01, 1, 3, shade * (0.9 + R() * 0.4), R());
      else tube(pts, width * (0.85 + R() * 0.3), 0.2, 6, shade * (0.88 + R() * 0.24), R());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 1));
  g.setIndex(index);
  const uniforms = { uTime: { value: 0 }, uSway: { value: gap * 0.05 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aT; attribute float aSeed; uniform float uTime; uniform float uSway;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aT * aT * uSway;
        transformed += vec3(sin(uTime * 1.7 + aSeed * 6.28 + aT * 3.0), 0.35 * sin(uTime * 2.3 + aSeed * 9.0), cos(uTime * 1.3 + aSeed * 4.0 + aT * 2.0)) * sw;`);
  };
  const hair = new THREE.Mesh(g, mat); hair.frustumCulled = false;

  // ---- dark cap just above the scalp so no skin shows between locks
  const cp = [], ci = [], map = new Map(), n3 = headMesh.geometry.attributes.normal;
  for (const i of tris) for (let k = 0; k < 3; k++) {
    const v = idx[i + k];
    if (!map.has(v)) { map.set(v, cp.length / 3); cp.push(P.getX(v) + n3.getX(v) * gap * 0.03, P.getY(v) + n3.getY(v) * gap * 0.03, P.getZ(v) + n3.getZ(v) * gap * 0.03); }
    ci.push(map.get(v));
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setIndex(ci); cg.computeVertexNormals();
  const cap = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color[0] * 0.6, o.color[1] * 0.6, o.color[2] * 0.6), roughness: 0.8 }));
  const group = new THREE.Group(); group.add(cap, hair);
  return { group, hair, cap, uniforms, triangles: index.length / 3 };
}
