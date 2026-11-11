// Procedural hair grown on a scanned head.
//
// Everything is computed in "upright head space": origin between the eyes, x = character's left,
// y = up, z = forward, one unit = the distance between the eyes. `frame` converts that space back
// to the scan's own coordinates, so the result can simply be parented next to the head mesh.
//
// Structure, copied from the two hair models the user generated (see README):
//   * hair near the scalp reads as one smooth shell; separate locks only show lower down
//   * a lock is a broad, flat ribbon that splits into two to four pointed tips of different lengths
//   * locks bend in long S-curves, and neighbouring locks bend together
//   * it is cut like a real haircut: long on top, short at the temples and the nape, so the long
//     top layer falls over the short under-layer
//   * hair is organised in sections: every lock of a section shares one flow direction, one bend and
//     one way of flicking at the tip; sections differ from each other and overlap at their edges
//   * a small number of free strands ignore the sections
//   * the wind opens up one side: locks there stream out, with long thin flyaways
//   * thin single strands lie across the surface, crossing the locks beneath them

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// smooth value noise in 3D, range 0..1 — makes neighbouring locks behave alike
function hash3(x, y, z) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), s = t => t * t * (3 - 2 * t);
  const u = s(x - xi), v = s(y - yi), w = s(z - zi), l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}

export const HAIR_DEFAULTS = {
  seed: 7,
  whorl: 16,            // extra locks around the crown so the whorl closes
  fringe: 18,           // extra locks over the forehead, where the face would otherwise show a bare hairline
  sectionSize: 0.95,    // spacing of section centres: smaller = more, smaller sections
  clumps: 125,          // locks
  clumpSpacing: 0.26,   // minimum distance between lock roots (eye-gap units)
  strays: 0,            // thin stray hairs travelling with each lock
  flyaways: 10,         // long thin hairs carried off by the wind
  surface: 8,          // thin hairs lying across the top of the locks
  skull: { c: [0, 0.55, -1.17], r: [1.3, 1.62, 1.5] },   // measured on assets/bald.glb
  crown: [0.12, 2.1, -1.45],
  wind: [-0.85, 0.1, -0.5],     // blows toward the character's right and back
  windStrength: 0.075,
  gravity: 0.14,
  part: 0.3,            // x of the fringe parting: locks sweep away from it to either side
  volume: 1.1,          // how far the outer layer stands off the skull (1 = on the skull)
  tuck: 0.05,           // how strongly locks below the ears curve back in toward the neck
  bell: 0.3,           // how slowly the silhouette narrows below the skull; smaller = fuller
  cutLong: 3.1,         // lock length at the crown (eye-gap units)
  cutShort: 0.6,        // lock length at the nape and temples
  wave: 0.145,          // strength of the long S-bends
  color: [0.015, 0.0105, 0.013],      // linear RGB, a brown-black
  specular: [0.11, 0.095, 0.108],
  shine: 46,
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
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const toUpright = v => { const d = v.clone().sub(mid); return V(d.dot(left), d.dot(up), d.dot(f)).divideScalar(gap); };
  const toScan = (p, out) => out.copy(mid).addScaledVector(left, p.x * gap).addScaledVector(up, p.y * gap).addScaledVector(f, p.z * gap);
  const dirToScan = (p, out) => out.set(0, 0, 0).addScaledVector(left, p.x).addScaledVector(up, p.y).addScaledVector(f, p.z).normalize();
  const C = V(...o.skull.c), RAD = V(...o.skull.r), CROWN = V(...o.crown), WIND = V(...o.wind).normalize();

  // ---- scalp triangles: used for root sampling and for the dark under-cap
  const P = headMesh.geometry.attributes.position, idx = headMesh.geometry.index.array;
  const U = new Array(P.count), tmp = V();
  for (let i = 0; i < P.count; i++) U[i] = toUpright(tmp.fromBufferAttribute(P, i));
  const tris = [], cum = []; let area = 0;
  const e1 = V(), e2 = V();
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
    return V().copy(a).addScaledVector(e1.subVectors(b, a), u).addScaledVector(e2.subVectors(c, a), v);
  };
  const outward = p => V().subVectors(p, C).divide(RAD).divide(RAD).normalize();   // ellipsoid normal
  const shell = p => V().subVectors(p, C).divide(RAD).length();                    // 1 = on the skull ellipsoid
  const lee = p => Math.max(0, Math.min(1, -p.x / 1.1 + 0.15));                    // 1 on the side the wind blows toward

  // ---- sections: the style parameters that all locks growing from one patch of scalp share
  const makeSection = centre => {
    const wild = centre ? centre.y < 1.4 && R() < 0.03 + 0.25 * lee(centre) : false;                   // whole sections on the lee side get caught by the wind
    return {
      centre, len: R(), long: R() < 0.16, swirl: (R() - 0.5) * 1.5 + 0.2, sweep: R(),
      flick: 0.13 + R() * 0.12, out: R() < 0.3, hookSteps: 4 + Math.floor(R() * 4),
      curly: R() < 0.45 ? (R() < 0.5 ? 1 : -1) * (0.05 + R() * 0.1) : 0,
      wPhase: R() * 6.28, wFreq: 0.2 + R() * 0.1, wAmp: 0.6 + R() * 0.8, ph1: R() * 6.28, ph2: R() * 6.28, fr: 0.55 + R() * 0.9,
      wild, wind: wild ? 1.5 + R() * 1.2 : 0.25 + R() * 0.7, lift: R() * 0.02 + (wild ? 0.03 : 0), gravity: wild ? 0.75 : 1, shade: 0.8 + R() * 0.45,
    };
  };
  const sections = [];
  for (let tries = 0; tries < 6000; tries++) {
    const r = pickRoot();
    if (!sections.every(sc => sc.centre.distanceToSquared(r) > o.sectionSize * o.sectionSize)) continue;
    const sc = makeSection(r), nr = outward(r);
    sc.dir = V().subVectors(r, CROWN); sc.dir.addScaledVector(nr, -sc.dir.dot(nr)).normalize().applyAxisAngle(nr, sc.swirl);
    sections.push(sc);
  }
  const sectionOf = p => { let best = sections[0], bd = 1e9; for (const sc of sections) { const d = sc.centre.distanceToSquared(p); if (d < bd) { bd = d; best = sc; } } return best; };

  // ---- grow one strand, returns its centre line
  function grow(root, k) {
    const S = k.sec, n = outward(root), az = Math.atan2(root.x, root.z - C.z);     // 0 = front, ±π = back
    const front = Math.max(0, 1 - Math.abs(az) / 1.0), back = Math.max(0, (Math.abs(az) - 1.9) / 1.2);
    // where the strand stops: fringe around the eyes (a few reach the nose); elsewhere tiered by root height
    const len = S.len * 0.8 + R() * 0.2;                                           // mostly the section's length, a little of its own
    let endY = front > 0 ? 0.8 - len * 0.45 - (S.long ? 0.8 : 0) : -0.25 - len * 1.25 - back * 0.1;
    if (k.endY !== undefined) endY = k.endY;
    // length of the cut: long on top, short at the temples and the nape
    const high = Math.min(1, Math.max(0, (root.y + 0.6) / 2.7));
    const cut = (o.cutShort + (o.cutLong - o.cutShort) * Math.pow(high, 1.25)) * (0.5 + 0.3 * high + len * (0.95 - 0.5 * high));
    const flow = V().subVectors(root, CROWN); flow.addScaledVector(n, -flow.dot(n)).normalize();
    flow.applyAxisAngle(n, (k.swirl ?? S.swirl));
    // pull toward the section's own direction, so its locks run parallel instead of fanning out (matters most at the crown)
    // (not right at the whorl, where that would send locks uphill across the crown)
    if (S.dir) { const far = Math.min(1, Math.max(0, (root.distanceTo(CROWN) - 0.45) / 0.6)); flow.lerp(S.dir, 0.5 * far); flow.addScaledVector(n, -flow.dot(n)).normalize(); }   // not a perfect star
    // fringe: sweep diagonally away from the parting instead of falling straight down
    if (front > 0.15) { flow.x += Math.sign(S.centre ? S.centre.x - o.part : root.x - o.part) * (0.12 + S.sweep * 0.45) * front; flow.addScaledVector(n, -flow.dot(n)).normalize(); }
    const d = flow.clone().addScaledVector(n, 0.04 + k.lift * 1.5).normalize();
    const step = 0.13, pts = [root.clone()], p = root.clone();
    const l0 = shell(root);                                                        // the real scalp is not exactly the ellipsoid
    const l1 = o.volume - 0.05 + k.lift * 2.5 + 0.07 * Math.min(1, Math.max(0, (root.y - 0.4) / 1.7)) + front * 0.05;   // higher roots lie on top
    const flick = S.flick * (front > 0 ? 0.3 : 1) * (k.flick ?? 1) * Math.min(1, 0.25 + high * 1.6), hookSteps = S.wild ? 3 : S.hookSteps;
    const curly = S.wild ? 0 : S.curly, outFlick = S.out || S.wild || front > 0, tuck = S.wild ? 0 : o.tuck;                                                         // the whole section twists the same way as it hooks
    const windK = o.windStrength * k.wind * (0.45 + 1.3 * lee(root)), g = o.gravity * (k.gravity ?? 1);
    // long S-bend, shared by the section
    const wPhase = S.wPhase + (R() - 0.5) * 0.25, wFreq = S.wFreq, wAmp = o.wave * (k.wave ?? 1) * S.wAmp;
    const ph1 = S.ph1, ph2 = S.ph2, fr = S.fr, max = k.maxSteps ?? 44, cutSteps = k.maxSteps ? 99 : Math.max(4, Math.round(cut / 0.13));
    const side = V(), hout = V(), e = V();
    let hook = 0;
    for (let s = 1; s <= max; s++) {
      const t = s / 20, lift = l0 + (l1 - l0) * Math.min(1, s / 7);
      side.crossVectors(d, outward(p)).normalize();
      hout.set(p.x / RAD.x, 0, (p.z - C.z) / RAD.z).normalize();                  // straight out from the head's axis
      if (hook) { if (outFlick) { d.addScaledVector(hout, flick); d.y += flick * 0.6; } else d.addScaledVector(hout, -flick * 0.45); d.addScaledVector(side, curly); }   // tip: curl outward and up
      else {
        d.y -= g;
        if (front === 0 && p.y < 0.5) d.addScaledVector(hout, -tuck * Math.min(1, (0.5 - p.y) / 0.6));   // round silhouette: tuck in below the ears
        d.addScaledVector(WIND, windK * t * t);
        d.addScaledVector(side, Math.sin(wPhase + s * wFreq) * wAmp * Math.min(1, s / 6));
        d.addScaledVector(side, Math.sin(s * 0.55 * fr + ph1) * k.curl);
        d.addScaledVector(outward(p), Math.sin(s * 0.4 * fr + ph2) * k.curl * 0.6);
      }
      d.normalize();
      const prev = p.clone(); p.addScaledVector(d, hook ? step * 0.7 : step);
      // keep outside the skull...
      e.subVectors(p, C).divide(RAD); const l = e.length();
      if (l < lift) { e.multiplyScalar(lift / l).multiply(RAD); p.copy(C).add(e); }
      // ...and below it keep a bell-shaped silhouette instead of collapsing onto the neck
      if (p.y < C.y && front === 0) {
        const hr = Math.hypot(p.x / RAD.x, (p.z - C.z) / RAD.z), min = lift * Math.max(0.5, 1 - o.bell * Math.pow(C.y - p.y, 1.5));
        if (hr < min) { p.x *= min / hr; p.z = C.z + (p.z - C.z) * min / hr; }
      }
      d.subVectors(p, prev).normalize();
      pts.push(p.clone());
      if (hook) { if (++hook > hookSteps) break; } else if ((p.y < endY && s > 5) || s >= cutSteps) { if (k.noHook) break; hook = 1; }
    }
    return pts;
  }

  // ---- turn centre lines into tapered tubes
  const pos = [], nor = [], tan = [], col = [], aT = [], aU = [], aSeed = [], index = [];
  const sp = V(), T = V(), B = V(), N = V(), q = V(), nn = V();
  function tube(pts, radius, flat, sides, shade, seed, taperFrom = 0.5) {
    const base = pos.length / 3, n = pts.length, ring = sides + 1;                // one extra vertex closes the seam for aU
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      N.copy(outward(pts[i])); B.crossVectors(T, N).normalize(); N.crossVectors(B, T).normalize();
      const r = radius * Math.min(1, 0.8 + t * 3) * (t < taperFrom ? 1 : Math.pow(Math.max(0, 1 - (t - taperFrom) / (1 - taperFrom)), 0.85));   // full width, then a long pointed tip
      for (let j = 0; j < ring; j++) {
        const a = (j / sides) * Math.PI * 2, cb = Math.cos(a), cn = Math.sin(a);
        q.copy(pts[i]).addScaledVector(B, cb * r).addScaledVector(N, cn * r * flat);
        toScan(q, sp); pos.push(sp.x, sp.y, sp.z);
        nn.set(0, 0, 0).addScaledVector(B, cb * flat).addScaledVector(N, cn);
        dirToScan(nn, sp); nor.push(sp.x, sp.y, sp.z);
        dirToScan(T, sp); tan.push(sp.x, sp.y, sp.z);
        const v = shade * (0.5 + 0.65 * Math.min(1, t * 2.2)) * (0.8 + 0.3 * (cn > 0 ? 1 : 0.35));   // darker at the root and underneath
        col.push(o.color[0] * v, o.color[1] * v, o.color[2] * v); aT.push(t); aU.push(j / sides); aSeed.push(seed);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const clampOut = (p, lift) => { const e = q.subVectors(p, C).divide(RAD), l = e.length(); if (l < lift) p.copy(C).add(e.multiplyScalar(lift / l).multiply(RAD)); return p; };

  // ---- locks
  const guides = [];
  for (let tries = 0; guides.length < o.clumps && tries < 40000; tries++) {
    const r = pickRoot();
    if (guides.every(gd => gd.root.distanceToSquared(r) > o.clumpSpacing * o.clumpSpacing)) guides.push({ root: r });
  }
  for (let tries = 0, made = 0; made < o.fringe && tries < 40000; tries++) {
    const r = pickRoot();
    if (r.z > -0.55 && r.y > 1.3 && Math.abs(r.x) < 1.0) { guides.push({ root: r, fringe: true }); made++; }
  }
  for (let tries = 0, made = 0; made < o.whorl && tries < 40000; tries++) {       // close the whorl at the crown
    const r = pickRoot();
    if (r.distanceTo(CROWN) < 0.5) { guides.push({ root: r, whorl: true }); made++; }
  }
  for (const gd of guides) {
    const sec = sectionOf(gd.root);
    const k = { sec, lift: sec.lift + R() * 0.008, wind: sec.wind, curl: 0.004 + R() * 0.008, gravity: sec.gravity };
    const path = grow(gd.root, k), n = path.length, shade = sec.shade * (0.92 + R() * 0.16);
    let width; const big = gd.fringe ? R() * 0.6 : R(); width = big < 0.3 ? 0.3 + R() * 0.08 : big < 0.8 ? 0.21 + R() * 0.06 : 0.12 + R() * 0.04;   // a few heavy locks, many medium, some thin
    const near = gd.root.distanceTo(CROWN) < 0.6; if (near) width = Math.min(width, 0.15);   // thin at the whorl, or they pile up into a knot
    const subs = width > 0.29 ? 2 : 1, l0 = shell(gd.root);
    const strays = Math.floor(o.strays + R());
    for (let m = 0; m < subs + strays; m++) {
      const stray = m >= subs, side = stray ? (R() - 0.5) * 3 : (m - (subs - 1) / 2) * 1.2;   // position across the lock, in widths
      const len = Math.max(5, Math.round(n * (stray ? 0.75 + R() * 0.35 : 0.8 + R() * 0.2)));
      const ph = R() * 6.28, amp = stray ? 0.07 * (0.5 + R()) : 0.012, pts = [], split = 0.5 + R() * 0.15;
      for (let i = 0; i < Math.min(len, n); i++) {
        const t = i / (n - 1), out = outward(path[i]);
        T.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
        B.crossVectors(T, out).normalize();
        const spread = stray ? 1 + t * 2 : 1 + Math.max(0, t - split) * 1.8;       // sub-locks lie side by side, then part at the tip
        const pnt = path[i].clone().addScaledVector(B, side * width * 0.5 * spread + Math.sin(i * 0.45 + ph) * amp * t * 3);
        pnt.addScaledVector(out, stray ? 0.03 + Math.cos(i * 0.5 + ph) * amp * t * 2 : -Math.abs(side) * 0.01);
        pts.push(clampOut(pnt, l0 + (o.volume - 0.07 - l0) * Math.min(1, i / 7)));
      }
      if (stray) tube(pts, 0.009 + R() * 0.008, 1, 3, shade * (0.9 + R() * 0.4), R(), 0.7);
      else tube(pts, width * (subs > 1 ? 0.5 : 0.8) * (0.9 + R() * 0.25), 0.2, 6, shade * (0.9 + R() * 0.2), R(), split - 0.05);
    }
  }
  // ---- long thin hairs carried off by the wind, mostly from the lee side
  for (let i = 0, made = 0; made < o.flyaways && i < 4000; i++) {
    const r = pickRoot(); if (r.y > 1.75 || R() > 0.12 + 0.88 * lee(r)) continue; made++;
    const pts = grow(r, { sec: makeSection(null), lift: 0.03 + R() * 0.05, wind: 2.5 + R() * 3, curl: 0.03 + R() * 0.05, gravity: 0.12 + R() * 0.25, wave: 1.6, endY: -9, maxSteps: 10 + Math.floor(R() * 11), noHook: true });
    tube(pts, 0.008 + R() * 0.009, 1, 3, 0.9 + R() * 0.5, R(), 0.6);
  }
  // ---- thin hairs lying across the surface, crossing the locks beneath them
  for (let i = 0; i < o.surface; i++) {
    const r = pickRoot();
    const pts = grow(r, { sec: makeSection(null), lift: 0.035 + R() * 0.03, wind: 0.5 + R() * 1.5, curl: 0.03 + R() * 0.04, wave: 1.8, swirl: (R() - 0.5) * 1.9, flick: 1.4 });
    tube(pts, 0.008 + R() * 0.008, 1, 3, 1 + R() * 0.5, R(), 0.7);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 1));
  g.setIndex(index);

  // ---- material: fine streaks along each lock and a soft band highlight that follows the strands
  const uniforms = {
    uTime: { value: 0 }, uSway: { value: gap * 0.05 }, uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uSpec: { value: new THREE.Color(...o.specular) }, uShine: { value: o.shine },
  };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aT; attribute float aU; attribute float aSeed; attribute vec3 aTan; uniform float uTime; uniform float uSway; varying float vU; varying float vSeed; varying float vT; varying vec3 vTan;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aT * aT * uSway;
        transformed += vec3(sin(uTime * 1.7 + aSeed * 6.28 + aT * 3.0), 0.35 * sin(uTime * 2.3 + aSeed * 9.0), cos(uTime * 1.3 + aSeed * 4.0 + aT * 2.0)) * sw;
        vU = aU; vSeed = aSeed; vT = aT; vTan = normalize(normalMatrix * aTan);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLightDir; uniform vec3 uSpec; uniform float uShine; varying float vU; varying float vSeed; varying float vT; varying vec3 vTan;
        float hairHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
        float hairStreak;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { // streaks run along the lock: they only depend on the position across it
          float u = vU * 26.0 + vSeed * 53.0, a = hairHash(floor(u)), b = hairHash(floor(u) + 1.0), w = fract(u);
          float fine = mix(a, b, w * w * (3.0 - 2.0 * w));
          float u2 = vU * 7.0 + vSeed * 19.0; float broad = mix(hairHash(floor(u2) + 9.0), hairHash(floor(u2) + 10.0), smoothstep(0.0, 1.0, fract(u2)));
          hairStreak = fine * 0.6 + broad * 0.4;
          diffuseColor.rgb *= mix(0.55, 1.55, hairStreak);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // strand highlight (Kajiya-Kay): brightest where the strand is perpendicular to the half vector
          vec3 Tn = normalize(vTan + normal * (hairStreak - 0.5) * 0.5);
          vec3 Hh = normalize(uLightDir + normalize(vViewPosition));
          float th = dot(Tn, Hh), sinTH = sqrt(max(0.0, 1.0 - th * th));
          float lit = smoothstep(-0.35, 0.5, dot(normal, uLightDir));
          reflectedLight.directSpecular += uSpec * (pow(sinTH, uShine) * 0.55 + pow(sinTH, uShine * 6.0) * 0.35) * lit * (0.4 + 0.9 * hairStreak);
        }`);
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
  const cap = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: new THREE.Color(o.color[0] * 0.8, o.color[1] * 0.8, o.color[2] * 0.8), roughness: 0.8 }));
  const group = new THREE.Group(); group.add(cap, hair);
  // call once per frame: time for the sway, and the key light direction (world space) for the highlight
  const lightView = new THREE.Vector3();
  function update(time, camera, lightDirWorld) {
    uniforms.uTime.value = time;
    uniforms.uLightDir.value.copy(lightView.copy(lightDirWorld).normalize().transformDirection(camera.matrixWorldInverse));
  }
  return { group, hair, cap, uniforms, update, triangles: index.length / 3 };
}
