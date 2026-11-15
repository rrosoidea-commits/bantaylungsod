/* ============================================================================
   scenes.js - 3D view (three.js). Draws what the engine says, nothing more:
   a person changes colour, coughs or lies down only when the engine recorded it.
   ========================================================================== */
const View3D = (() => {
  let lamps = [], pending = [], flashes = [], onCoughCb = null, overflowG = null, guardG = null, gl, scene, camera, hemi, sun, root, people, lines, badges, clouds = [], ok = false, sim = null, envKey = null, viewIdx = 0, dark = false;
  const cam = { az: 0.5, el: 0.4, dist: 90, tx: 0, tz: 0, ty: 3, follow: -1 };
  const opt = { truth: false, links: false, tint: false, contacts: false, air: true, dose: true };
  let fogs = [], roadG = null, curtainG = null, evT = -1, evK = -1, onSayCb = null, onBreachCb = null;
  const PARTS = ["legL", "legR", "torso", "armL", "armR", "head", "hair", "hairLong", "skirt", "mask", "shield", "bag", "wchair", "wheelL", "wheelR", "ring", "dring", "marker", "plume", "dosering", "aura"];
  const SUBN = typeof SUB !== "undefined" ? SUB : 12;   // engine sub-steps per hour (5 minutes each)
  const SKIN = [0xf1c9a5, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac], HAIR = [0x1b1b1b, 0x2c1b10, 0x4a2f1b, 0x111111],
    SHIRT = [0x3d6fb4, 0xb5473c, 0x2e8b6f, 0xd9a441, 0x7a5ea8, 0xe7e3d6, 0x39424e, 0xc96f9b, 0x4f9fb8, 0x8a8f3a], PANTS = [0x2b3440, 0x1f2a44, 0x4a4033, 0x5b6470, 0x232323, 0x3b4a6b];
  const STATE_COL = [0x4c93ec, 0xf0a81e, 0xff5d5d, 0xe64980, 0x2ed9a3, 0x8a93a8];
  let _b, _l, _m, _p, _q, _s, _e, _zero, cols, colMask, colInk, colSick, colGrey, colSel, colShield, colGlove, BAGS, tmpC, tmpC2, colBreath, colViral, colDoseLo, colDoseHi, colPPE, colBreach, colArcLo, colArcHi, colPass;
  let seedR = 7; const R = () => { seedR = (seedR * 16807) % 2147483647; return seedR / 2147483647; }, rr = (a, b) => a + (b - a) * R();

  /* ---------- helpers for props ---------- */
  let G = null; // current group
  const add = m => { G.add(m); return m; };
  const mat = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color: c }, o || {}));
  function box(w, h, d, c, x, y, z, o) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o)); m.position.set(x, y, z); return add(m); }
  function cyl(r1, r2, h, c, x, y, z, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg || 10), mat(c)); m.position.set(x, y, z); return add(m); }
  function tex(draw, rx, ry) { const c = document.createElement("canvas"); c.width = c.height = 128; draw(c.getContext("2d")); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); return t; }
  function plane(w, d, c, x, z, y, o) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(c, o)); m.rotation.x = -Math.PI / 2; m.position.set(x, y || 0.02, z); m.userData.flat = 1; return add(m); }
  function floor(w, d, draw, rx, ry, x, z) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex(draw, rx, ry) })); m.rotation.x = -Math.PI / 2; m.position.set(x || 0, 0.01, z || 0); m.userData.flat = 1; return add(m); }
  const tiles = (a, b) => g => { g.fillStyle = a; g.fillRect(0, 0, 128, 128); g.strokeStyle = b; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128); g.strokeRect(0, 0, 64, 64); g.strokeRect(64, 64, 64, 64); };
  const winTex = (wall, win, rx, ry) => tex(g => { g.fillStyle = wall; g.fillRect(0, 0, 128, 128); g.fillStyle = win; for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) g.fillRect(8 + a * 32, 10 + b * 32, 16, 20); }, rx, ry);
  function building(w, h, d, x, z, wall, win, roof) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: winTex(wall, win, Math.max(1, Math.round(w / 12)), Math.max(1, Math.round(h / 9))) })); m.position.set(x, h / 2, z); add(m); box(w + 1.4, 1, d + 1.4, roof || 0x8a8f92, x, h + 0.5, z); }
  function palm(x, z, h) { h = h || 11; cyl(0.35, 0.5, h, 0x8a6a45, x, h / 2, z, 7); for (let k = 0; k < 7; k++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6.5, 4), mat(k % 2 ? 0x2f8f4a : 0x3aa55a)); const a = k / 7 * 6.283; f.position.set(x + Math.cos(a) * 2.6, h - 0.6, z + Math.sin(a) * 2.6); f.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25); f.scale.set(1, 1, 0.35); add(f); } }
  function acacia(x, z, s) { s = s || 1; cyl(0.7 * s, 1 * s, 7 * s, 0x6b4a2e, x, 3.5 * s, z, 7); for (const [dx, dy, dz, r] of [[0, 9, 0, 6], [4, 8, 1, 4.5], [-4, 8.5, -1, 4.5], [1, 8, -4, 4], [-1, 8, 4, 4]]) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), mat(0x3c8c4c)); m.position.set(x + dx * s, dy * s, z + dz * s); m.scale.y = 0.55; add(m); } }
  function lamp(x, z) { cyl(0.22, 0.3, 9, 0x30363a, x, 4.5, z, 6); const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe9e9e2 })); b.position.set(x, 9.3, z); add(b);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false })); glow.position.copy(b.position); add(glow); glow.userData.ns = 1;
    let light = null; if (lamps.filter(l => l.g === G && l.light).length < 4) { light = new THREE.PointLight(0xffd9a0, 0, 60, 1.4); light.position.set(x, 8.6, z); G.add(light); } lamps.push({ b, glow, light, g: G }); }
  function grp(x, z, rot) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot || 0; G.add(g); return g; }
  function gbox(g, w, h, d, c, x, y, z, o) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, o)); m.position.set(x, y, z); g.add(m); return m; }
  function gwheel(g, r, w, x, y, z) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 12), mat(0x1b1e20)); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); g.add(m); }
  function jeepney(x, z, rot, body, trim, lit) { const g = grp(x, z, rot);
    gbox(g, 13, 0.5, 5.2, 0x8f979b, -1, 1.5, 0); gbox(g, 13, 2.0, 5.2, body, -1, 2.7, 0); gbox(g, 13.6, 0.5, 5.6, 0xdfe4e6, -1, 6.4, 0);
    for (let k = -7; k <= 5; k += 2.4) gbox(g, 0.35, 2.4, 5.2, 0xc9cfd2, k, 5, 0);
    for (const s of [-1, 1]) { gbox(g, 13, 0.35, 0.2, trim, -1, 3.2, s * 2.65); gbox(g, 13, 0.3, 0.2, 0xf1c232, -1, 2.2, s * 2.66); gbox(g, 2.2, 0.5, 0.9, trim, 7.2, 3.7, s * 2.2);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: lit ? 0xfff3b0 : 0xf4f1e6 })); l.position.set(9.5, 2.9, s * 1.6); g.add(l); }
    gbox(g, 4.2, 2.2, 4.2, body, 7.2, 2.6, 0); gbox(g, 0.3, 2.4, 4.6, 0xc9cfd2, 5.6, 5, 0); gbox(g, 0.3, 1.7, 3.4, 0xd5dadc, 9.4, 2.5, 0); gbox(g, 0.6, 0.5, 5, 0xd5dadc, 9.6, 1.5, 0); gbox(g, 10, 0.4, 3.4, 0xbfc5c8, -1, 6.9, 0);
    for (const [wx, wz] of [[6.8, 2.3], [6.8, -2.3], [-5, 2.3], [-5, -2.3]]) gwheel(g, 1.1, 0.8, wx, 1.1, wz); return g; }
  function car(x, z, rot, c) { const g = grp(x, z, rot); gbox(g, 8, 1.6, 3.6, c, 0, 1.6, 0); gbox(g, 4.6, 1.5, 3.3, c, -0.4, 3.1, 0); gbox(g, 4.7, 1.1, 3.35, 0x22303a, -0.4, 3.15, 0, { transparent: true, opacity: 0.55 }); for (const [wx, wz] of [[2.6, 1.7], [2.6, -1.7], [-2.6, 1.7], [-2.6, -1.7]]) gwheel(g, 0.8, 0.5, wx, 0.8, wz); }
  function tricycle(x, z, rot, c) { const g = grp(x, z, rot); gbox(g, 3.6, 2.6, 2.4, c, 0, 2, 1.2); gbox(g, 3.8, 0.3, 2.7, 0xdfe4e6, 0, 3.5, 1.2); gbox(g, 3.4, 0.5, 0.6, 0x30363a, 0.4, 1.6, -0.9); for (const [wx, wz] of [[1.9, -0.9], [-1.6, -0.9], [0, 2.5]]) gwheel(g, 0.7, 0.35, wx, 0.7, wz); }
  function umbrella(x, z, c, r) { r = r || 3.4; cyl(0.12, 0.12, 6, 0x777f83, x, 3, z, 6); for (let k = 0; k < 8; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, r, 1.3, 8, 1, false, k / 8 * 6.283, 6.283 / 8), mat(c[k % c.length], { side: THREE.DoubleSide })); m.position.set(x, 6.2, z); add(m); } }
  function stall(x, z, rot, goods, awn) { const g = grp(x, z, rot); gbox(g, 7, 0.3, 3.2, 0x9a7b55, 0, 2.3, 0); for (const sx of [-3.2, 3.2]) for (const sz of [-1.3, 1.3]) gbox(g, 0.25, 2.3, 0.25, 0x6f5a3e, sx, 1.15, sz);
    for (let a = -2.8; a <= 2.8; a += 0.8) for (let b = -1; b <= 1; b += 0.7) { const m = new THREE.Mesh(R() < 0.5 ? new THREE.SphereGeometry(0.3, 7, 6) : new THREE.BoxGeometry(0.55, 0.35, 0.5), mat(goods[Math.floor(R() * goods.length)])); m.position.set(a, 2.65, b); g.add(m); }
    if (awn) { gbox(g, 7.6, 0.2, 4.4, awn, 0, 6.2, 0.4).rotation.x = 0.12; for (const sx of [-3.6, 3.6]) gbox(g, 0.18, 6.2, 0.18, 0x777f83, sx, 3.1, -1.6); } }
  function banderitas(x0, z0, x1, z1, y) { const c = [0xe74c3c, 0xf1c40f, 0x2e86de, 0x27ae60, 0xff7eb6, 0xffffff], n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / 1.1); for (let k = 0; k <= n; k++) { const t = k / n, m = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 3), mat(c[k % 6], { side: THREE.DoubleSide })); m.position.set(x0 + (x1 - x0) * t, y - Math.sin(t * Math.PI) * 1.2, z0 + (z1 - z0) * t); m.rotation.x = Math.PI; m.scale.z = 0.15; m.rotation.y = Math.atan2(x1 - x0, z1 - z0) + 1.57; m.userData.ns = 1; add(m); } }
  function bed(x, z, rot, sheet, iv) { const g = grp(x, z, rot); gbox(g, 3, 0.3, 7, 0xb9c2c6, 0, 1.5, 0); gbox(g, 2.8, 0.5, 6.6, 0xf4f6f6, 0, 1.9, 0); gbox(g, 2.2, 0.35, 1.3, 0xcfe4f2, 0, 2.25, -2.5); gbox(g, 3, 1.6, 0.2, 0x9aa7ad, 0, 2.2, -3.5); gbox(g, 2.8, 0.2, 3.2, sheet || 0xa8d8c9, 0, 2.2, 1.5);
    for (const sx of [-1.3, 1.3]) for (const sz of [-3.2, 3.2]) gbox(g, 0.2, 1.5, 0.2, 0x8a959a, sx, 0.75, sz); if (iv !== false) { gbox(g, 0.12, 6, 0.12, 0xb9c2c6, 2.1, 3, -2.6); gbox(g, 0.5, 0.9, 0.25, 0xe8f3f7, 2.1, 5.6, -2.6, { transparent: true, opacity: 0.8 }); } }
  function cot(x, z, rot) { const g = grp(x, z, rot); gbox(g, 2.6, 0.25, 6.6, 0xf4f6f6, 0, 0.75, 0); gbox(g, 2.6, 0.2, 2.6, 0x8fd0ee, 0, 0.9, 1.6); for (const sx of [-1.1, 1.1]) for (const sz of [-3, 3]) gbox(g, 0.18, 0.7, 0.18, 0x8a959a, sx, 0.35, sz); }
  function tent(x, z, w, d) { box(w, 0.25, d, 0xf7f9f9, x, 7.2, z, { transparent: true, opacity: 0.85 }).userData.ns = 1; box(w, 0.9, 0.3, 0xe03131, x, 6.6, z + d / 2); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(0.18, 0.18, 7.2, 0xcfd6d8, x + sx * (w / 2 - 0.4), 3.6, z + sz * (d / 2 - 0.4), 6); }
  function ambulance(x, z, rot) { const g = grp(x, z, rot); gbox(g, 11, 4.6, 4.6, 0xf7f9f9, -1, 3.3, 0); gbox(g, 3.4, 3.2, 4.4, 0xf7f9f9, 6, 2.6, 0); gbox(g, 1.6, 1.5, 4.2, 0x22303a, 6.6, 3.6, 0, { transparent: true, opacity: 0.6 }); gbox(g, 11.05, 0.7, 4.65, 0xe03131, -1, 2.6, 0); gbox(g, 11.05, 0.25, 4.65, 0xf59f00, -1, 3.3, 0); gbox(g, 1.4, 0.45, 2.6, 0xe03131, 3.6, 5.85, 0); gbox(g, 1.4, 0.46, 1.2, 0x1c7ed6, 3.6, 5.86, 0); for (const [wx, wz] of [[5.4, 2.1], [5.4, -2.1], [-4, 2.1], [-4, -2.1]]) gwheel(g, 1, 0.7, wx, 1, wz); }
  function ground(c) { const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat(c)); m.rotation.x = -Math.PI / 2; m.position.y = -0.12; m.userData.flat = 1; add(m); }
  function crossing(x, z, len, wid) { for (let k = 0; k < Math.floor(len / 2.4); k++) plane(wid, 1.2, 0xf2f2ee, x, z - len / 2 + 1 + k * 2.4, 0.05); }
  function benchProp(x, z, rot) { const g = grp(x, z, rot); gbox(g, 4, 0.22, 1.1, 0x9a7b55, 0, 0.82, 0); gbox(g, 4, 0.9, 0.18, 0x8a6a45, 0, 1.3, -0.5); for (const sx of [-1.7, 1.7]) gbox(g, 0.2, 0.8, 1, 0x555d61, sx, 0.4, 0); }
  function cartProp(x, z) { const g = grp(x, z, 0); gbox(g, 3.2, 1.6, 1.8, 0xf4f1e6, 0, 1.5, 0); gbox(g, 3.4, 0.2, 2, 0xc0392b, 0, 2.4, 0); for (const sx of [-1.2, 1.2]) gwheel(g, 0.6, 0.25, sx, 0.6, 0.95); umbrella(x, z, [0xf1c40f, 0xe74c3c], 2.6); }
  function canteenTable(x, z) { box(2.6, 0.16, 1.4, 0xf3f1ea, x, 1.55, z); cyl(0.12, 0.16, 1.5, 0x555d61, x, 0.75, z, 6); for (const dz of [-1.35, 1.35]) for (const dx of [-0.7, 0.7]) cyl(0.32, 0.32, 0.12, 0xd9482b, x + dx, 0.95, z + dz, 10), cyl(0.07, 0.07, 0.9, 0x555d61, x + dx, 0.45, z + dz, 5); }
  function poiProps(env) { const Z = env.zones[0]; for (const q of env.pois || []) { if (q.kind === "bench") benchProp(Z.ox + q.x, Z.oz + q.z, q.cx != null ? Math.atan2(q.x - q.cx, q.z - q.cz) : 0); if (q.prop === "cart") cartProp(Z.ox + q.x, Z.oz + (q.z + q.vz) / 2); } }
  function careArea(env) { const b = env.beds; if (!b.length) return; const Z = env.zones[0]; const xs = b.map(q => Z.ox + q.x), zs = b.map(q => Z.oz + q.z); for (const q of b) cot(Z.ox + q.x, Z.oz + q.z, q.yaw);
    tent((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...zs) - Math.min(...zs) + 8); }

  /* ---------- the five locations (seven views) ---------- */
  const BUILD = {
    cityhall() { ground(0x9fcf9a);
      floor(132, 60, tiles("#f3efe4", "#ddd6c6"), 13, 6, -6, -12); plane(170, 22, 0x4a4f55, 0, 30, 0.02); plane(170, 0.5, 0xf2f2ee, 0, 30, 0.04); crossing(0, 30, 22, 14); crossing(-44, 30, 22, 10); plane(170, 3, 0xb9b4aa, 0, 17.5, 0.03);
      building(54, 20, 16, 0, -52, "#f0d48a", "#6f5a3a", 0xb5533c); building(22, 15, 14, -38, -52, "#f3dc9c", "#6f5a3a", 0xb5533c); building(22, 15, 14, 38, -52, "#f3dc9c", "#6f5a3a", 0xb5533c);
      box(34, 1.4, 8, 0xe9e2d0, 0, 0.7, -42.6); for (let q = -14; q <= 14; q += 4) cyl(0.9, 1, 13, 0xfaf6ea, q, 7.8, -42, 12); box(34, 1.6, 7, 0xfaf6ea, 0, 15, -42);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 19.5, 5.5, 3, 1), mat(0xf0d48a)); ped.rotation.set(0, Math.PI / 2, 0); ped.scale.z = 0.2; ped.position.set(0, 18.6, -42); add(ped);
      cyl(9, 9, 0.8, 0xcfd6d8, 0, 0.4, -14, 24); cyl(7.6, 7.6, 1, 0x7fc6e6, 0, 0.5, -14, 24); cyl(1, 1.6, 4, 0xe9e2d0, 0, 2.6, -14, 10);
      for (const x of [-46, -30, 30, 46]) palm(x, -40, rr(10, 13)); acacia(64, -30, 1); for (const x of [-50, -30, -10, 10, 30, 50]) lamp(x, 15.5);
      jeepney(-26, 25, 0, 0xd9a11e, 0xc0392b); jeepney(34, 35, Math.PI, 0x1c7ed6, 0xf1c232); car(4, 35, Math.PI, 0xc9ced2); car(-58, 25, 0, 0xb5473c); tricycle(56, 25, 0, 0x2e8b6f);
      box(8, 3, 3, 0xf4f1e6, 30, 1.5, -8); umbrella(30, -8, [0xe74c3c, 0xffffff]); },
    market() { ground(0x8d8778);
      floor(96, 60, g => { g.fillStyle = "#d8d2c6"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#c9c2b5"; for (let q = 0; q < 50; q++) g.fillRect((q * 37) % 128, (q * 53) % 128, 6, 3); }, 11, 7, 6, 0);
      const fish = [0xb9c4cc, 0x9fb1bd, 0xe8a0a0, 0xd7dee2], veg = [0x3fa34d, 0xe67e22, 0xf1c40f, 0xc0392b, 0x8e44ad, 0x7cb342], meat = [0xd96c6c, 0xc0504d, 0xe9a3a3, 0xf2d0c9], dry = [0xd9b382, 0xf4e6c8, 0xb07a45, 0xffffff];
      for (let k = 0; k < 5; k++) { const x = -28 + k * 14; stall(x, -22, 0, [fish, veg, meat, dry, veg][k], [0x2e86de, 0xe74c3c, 0xf1c40f, 0x27ae60, 0xe67e22][k]); stall(x, 22, Math.PI, [veg, meat, dry, fish, veg][k], [0xe74c3c, 0xf1c40f, 0x2e86de, 0xe67e22, 0x27ae60][k]); }
      for (let k = 0; k < 3; k++) { stall(-22 + k * 22, 0, 0, [veg, fish, meat][k]); umbrella(-22 + k * 22, 0, [[0xe74c3c, 0xf1c40f], [0x2e86de, 0xffffff], [0x27ae60, 0xf1c40f]][k], 4.4); }
      for (const z of [-26, 26]) for (let x = -34; x <= 34; x += 17) cyl(0.4, 0.4, 14, 0x6f7a80, x, 7, z, 6);
      box(78, 0.5, 64, 0xdfe4e6, 0, 14.4, 0, { transparent: true, opacity: 0.14 }).userData.ns = 1;
      banderitas(-34, -10, 34, -10, 11); banderitas(-34, 10, 34, 10, 11); for (const [x, z] of [[-40, -29], [50, -29], [-40, 29], [50, 29]]) lamp(x, z); },
    university() { ground(0x5f9e58);
      plane(140, 100, 0x6fae5f, 4, 0, 0.02); plane(8, 100, 0xcfc9bb, -22, 0, 0.04); plane(130, 7, 0xcfc9bb, 0, 26, 0.04); plane(60, 6, 0xcfc9bb, 24, -18, 0.04);
      for (const [x, z, w, d, h] of [[-10, -60, 70, 14, 18], [48, -58, 34, 14, 24], [-74, -10, 14, 60, 16]]) { building(w, h, d, x, z, "#f3f1ea", "#5a6b78", 0x7a1f2b); box(w + 0.4, 1.1, d + 0.4, 0x7a1f2b, x, h * 0.5, z); }
      box(58, 0.6, 9, 0xe9e6dc, -10, 6.5, -48.5); for (let x = -38; x <= 18; x += 7) cyl(0.4, 0.4, 6.4, 0xf3f1ea, x, 3.2, -44.3, 8); plane(56, 8, 0xd8d3c6, -10, -48.5, 0.05);
      plane(20, 12, 0xd8d2c4, 30, -34, 0.05); for (const x of [24, 30, 36]) canteenTable(x, -34); box(20, 0.5, 12, 0x7a1f2b, 30, 9, -34); for (const [sx, sz] of [[22, -38], [38, -38], [22, -30], [38, -30]]) cyl(0.3, 0.3, 8, 0xdfe4e6, sx, 5, sz, 6);
      for (const [x, z, s] of [[-62, 34, 1.3], [-62, -36, 1.1], [10, 48, 1.2], [44, 50, 1.2], [-30, 48, 1]]) acacia(x, z, s); for (const [x, z] of [[-26, -30], [-26, 4], [-26, 34], [14, 30], [48, 30]]) lamp(x, z); },
    jeep() { ground(0x8f9a8c);
      plane(28, 400, 0x4a4f55, -4, 0, 0.0); { const keep = G; roadG = G = new THREE.Group(); keep.add(roadG); for (let z = -126; z <= 126; z += 9) { plane(0.5, 4, 0xe8e8e0, -6, z, 0.02); plane(0.5, 4, 0xe8e8e0, -14, z + 4, 0.02); } G = keep; } plane(7, 400, 0xb9b4aa, 13.5, 0, 0.03); plane(7, 400, 0xb9b4aa, -21.5, 0, 0.03);
      plane(6.4, 26, 0x3d4246, 0, 0, 1.0); box(7.4, 1, 26.4, 0x8f979b, 0, 0.5, 0);
      for (const s of [-1, 1]) { box(1.7, 1.15, 24, 0xb3261e, s * 2.55, 1.6, 0); box(0.5, 1.5, 24, 0xc92a2a, s * 3.25, 2.9, 0); box(0.3, 2.6, 26, 0xf1c232, s * 3.62, 2.2, 0); box(0.34, 0.5, 26.05, 0xc0392b, s * 3.63, 2.6, 0); box(0.34, 0.3, 26.05, 0x1c7ed6, s * 3.63, 1.7, 0);
        const r = cyl(0.07, 0.07, 25, 0xe9ecef, s * 1.2, 6.05, 0, 8); r.rotation.x = Math.PI / 2; r.userData.ns = 1; }
      { const keep = G; curtainG = G = new THREE.Group(); keep.add(curtainG); for (const s of [-1, 1]) for (let z = -11.4; z <= 11.4; z += 3.25) box(0.12, 2.3, 3.1, 0x2f6fa8, s * 3.66, 4.6, z); G = keep; } box(0.25, 0.5, 26, 0xcfd6d8, -3.5, 6.35, 0); for (let z = -13; z <= 13; z += 3.25) box(0.3, 2.9, 0.3, 0xcfd6d8, -3.5, 4.8, z);
      for (const z of [-12.5, -4, 4, 12.5]) box(7.2, 0.16, 0.16, 0xcfd6d8, 0, 6.3, z).userData.ns = 1;
      box(7.4, 1.6, 0.3, 0xcfd6d8, 0, 1.8, -13.1); box(7.4, 1.0, 5, 0xf1c232, 0, 1.5, -15.8); for (const sx of [-1, 1]) box(0.3, 2.6, 5, 0xf1c232, sx * 3.55, 2.3, -15.8); box(7.4, 1.4, 0.5, 0xf1c232, 0, 2.7, -18.2); cyl(0.7, 0.7, 0.15, 0x22303a, -1.5, 3.3, -17.4, 12).rotation.x = 1.1; box(6, 2.4, 5.5, 0xf1c232, 0, 2.2, -20.8); box(6.2, 0.5, 5.6, 0xc0392b, 0, 3.5, -20.8); box(5, 1.8, 0.4, 0xd5dadc, 0, 2.2, -23.7);
      for (const [wx, wz] of [[3.9, -19.5], [-3.9, -19.5], [3.9, 8], [-3.9, 8]]) { const w = cyl(1.3, 1.3, 0.9, 0x1b1e20, wx, 1.3, wz, 14); w.rotation.z = Math.PI / 2; }
      building(16, 24, 46, -34, -34, "#d9c7a3", "#4f5a63"); building(16, 16, 40, -34, 16, "#b9c4c9", "#33424f"); building(14, 9, 60, 26, -40, "#e3d6b8", "#5a4a3a"); palm(-21.5, 6, 12); palm(-21.5, -30, 12); palm(13.5, -34, 11); car(-12, -36, Math.PI / 2, 0xc9ced2); },
    queue() { ground(0x6f7a72);
      plane(220, 24, 0x2b3036, 0, 12, 0.02); for (let x = -90; x <= 90; x += 8) plane(4, 0.4, 0xd9d9d0, x, 12, 0.04);
      floor(180, 18, tiles("#6f747a", "#5b6066"), 22, 2, 0, -9); box(180, 0.5, 0.8, 0x9aa0a6, 0, 0.25, 0.4);
      for (const [x, w, h, c] of [[-62, 30, 26, "#3a4354"], [-28, 26, 34, "#2f3848"], [4, 30, 22, "#454c5c"], [38, 28, 30, "#343c4c"], [70, 26, 24, "#3a4354"]]) building(w, h, 12, x, -26, c, "#f6d77a");
      box(26, 0.5, 6, 0x1c7ed6, -6, 7.5, -12); for (const x of [-18, -6, 6]) cyl(0.22, 0.22, 7.5, 0xcfd6d8, x, 3.75, -14.5, 6); box(24, 1.2, 1, 0x8a6a45, -6, 1.4, -14);
      for (const x of [-60, -36, -12, 12, 36, 60]) { cyl(0.25, 0.3, 12, 0x555d61, x, 6, -1.2, 6); box(3, 0.25, 0.6, 0x555d61, x, 12, 0.2); const l = Math.abs(x) < 40 ? new THREE.PointLight(0xffd9a0, 0, 60, 1.4) : null; if (l) { l.position.set(x, 11.4, 1.2); G.add(l); } const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: 0xe9e9e2 })); b.position.set(x, 11.6, 1.3); add(b); const glow = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false })); glow.position.copy(b.position); add(glow); glow.userData.ns = 1; lamps.push({ b, glow, light: l, g: G }); }
      jeepney(31, 5.5, Math.PI, 0xc0392b, 0xf1c232, true); jeepney(-44, 17, 0, 0x2e8b6f, 0xf1c232, true); car(62, 17, 0, 0x8a8f94); },
    ward() { ground(0x7f8c8e);
      floor(92, 40, g => { g.fillStyle = "#c3d0ce"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#b3c2c0"; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64); }, 11, 5, 0, -1);
      box(92, 12, 0.6, 0xdfe8e6, 0, 6, -20.3); box(92, 2.4, 0.7, 0x66c2b0, 0, 3.4, -20.2); box(0.6, 12, 40, 0xdfe8e6, -46.3, 6, -1); for (let x = -36; x <= 36; x += 12) box(5, 3.4, 0.3, 0x9fd0e8, x, 8, -20, { transparent: true, opacity: 0.6 });
      for (let x = -36; x <= 36; x += 18) cyl(0.6, 0.6, 12, 0xf4f6f7, x, 6, 18.5, 8);
      box(12, 3.4, 3, 0xdfe6e4, 38, 1.7, 15.2); box(12.4, 0.3, 3.4, 0x66c2b0, 38, 3.5, 15.2);
      { const sg = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.2), new THREE.MeshBasicMaterial({ map: tex(g => { g.fillStyle = "#1c7ed6"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#fff"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.fillText("REGISTRATION", 64, 72); }, 1, 1), side: THREE.DoubleSide })); sg.position.set(38, 8.6, 19.2); sg.rotation.y = Math.PI; add(sg); sg.userData.ns = 1; box(12.4, 0.3, 0.3, 0x30363a, 38, 9.9, 19.2); }
      plane(5.4, 12, 0xf6e7b0, 38, 6.4, 0.03); for (const sx of [-3, 3]) for (const sz of [1, 6.4, 11.8]) cyl(0.12, 0.16, 2.2, 0xc9a227, 38 + sx, 1.1, sz, 6);
      box(0.6, 12, 12, 0xdfe8e6, 46.3, 6, -14.3); box(0.6, 3, 16, 0xdfe8e6, 46.3, 10.5, 0); box(0.7, 1.2, 8, 0x2ed9a3, 46.4, 8.4, 0); plane(8, 10, 0xb9c9c6, 50, 0, 0.02);
      for (let x = -40; x <= 40; x += 16) { box(4, 0.35, 2.4, 0xeef2f3, x, 11.8, -1); box(3.4, 0.1, 1.8, 0x8a959a, x, 11.6, -1); } for (const x of [-30, 0, 30]) { box(4.2, 2.2, 0.5, 0xeef2f3, x, 10.4, -19.9); for (let k = 0; k < 4; k++) box(3.6, 0.12, 0.1, 0x8a959a, x, 9.7 + k * 0.45, -19.6); }
      for (let x = -30; x <= 30; x += 10) { bed(x, -12.5, 0, 0xa8d8c9); bed(x, 8, Math.PI, 0xc7d7f0); if (x < 30) { box(0.15, 7, 6, 0x8fc0c9, x + 5, 3.5, -13.5, { transparent: true, opacity: 0.4 }); box(0.15, 7, 6, 0x8fc0c9, x + 5, 3.5, 9, { transparent: true, opacity: 0.4 }); } } },
    yard() { ground(0x8e9a8e);
      floor(124, 56, tiles("#f1ecdf", "#d9d2c2"), 14, 6, 0, 4); plane(170, 16, 0x555a60, 0, 40, 0.02); plane(16, 20, 0x555a60, -44, 23, 0.02);
      building(60, 34, 16, -8, -36, "#f4f6f7", "#3d7fc4", 0xe8590c); box(60.4, 2.2, 16.4, 0xe8590c, -8, 12, -36); box(60.4, 2.2, 16.4, 0xe8590c, -8, 23, -36); building(24, 22, 16, 38, -36, "#e8590c", "#2f5f96", 0xf4f6f7);
      box(40, 0.8, 16, 0xe8590c, -8, 9, -20); for (const x of [-26, -14, -2, 10]) for (const z of [-26, -14]) cyl(0.5, 0.5, 9, 0xf4f6f7, x, 4.5, z, 8);
      acacia(-58, -12, 1.1); acacia(60, -14, 1.1);
      const yardG = G, og = new THREE.Group(); yardG.add(og); G = og; overflowG = og;
      let k = 0; for (const z of [-2.8, 9.2]) for (let x = -31.5; x <= 31.6; x += 9) bed(x, z, 0, [0xa8d8c9, 0xf3c4c4, 0xc7d7f0, 0xf4e2a8][k++ % 4]);
      for (const x of [-24, 0, 24]) { box(23.4, 0.25, 24, 0x3d7fc4, x, 8.2, 3.2, { transparent: true, opacity: 0.5 }).userData.ns = 1; for (const [sx, sz] of [[-11.4, -11.6], [11.4, -11.6], [-11.4, 11.6], [11.4, 11.6]]) cyl(0.15, 0.15, 8.2, 0xcfd6d8, x + sx, 4.1, 3.2 + sz, 6); }
      G = yardG;
      ambulance(-52, -12, -Math.PI / 2); ambulance(14, 40, 0); for (const x of [-52, -18, 20, 54]) lamp(x, 31); },
  };
  // which builder, where in the world, and the default camera for each view of each location
  const VIEWS = {
    cityhall: [{ name: "Plaza", build: "cityhall", off: 0, zone: 0, sky: "#bfe4f7", cam: { az: 0.42, el: 0.42, dist: 96, tx: -4, tz: -10, ty: 3 } }],
    market: [{ name: "Aisles", build: "market", off: 0, zone: 0, sky: "#c9e6f5", cam: { az: 0.5, el: 0.5, dist: 66, tx: 2, tz: -3, ty: 3 } }],
    university: [{ name: "Campus field", build: "university", off: 0, zone: 0, sky: "#bfe4f7", cam: { az: 0.55, el: 0.42, dist: 104, tx: 4, tz: -4, ty: 3 } }],
    jeepney: [{ name: "Inside the jeep", build: "jeep", off: 400, zone: 0, sky: "#bfe4f7", cam: { az: 0.55, el: 0.8, dist: 36, tx: 400, tz: -3, ty: 3 } },
              { name: "Jeepney stop", build: "queue", off: 0, zone: 1, sky: "#bfe4f7", cam: { az: 0.75, el: 0.3, dist: 58, tx: 0, tz: -3, ty: 3 } }],
    hospital: [{ name: "Inside the ward", build: "ward", off: 0, zone: 0, sky: "#b9c9cf", indoor: true, cam: { az: 0.3, el: 0.6, dist: 76, tx: 8, tz: 0, ty: 2 } },
               { name: "Outside", build: "yard", off: 400, zone: 1, sky: "#cfe6f2", cam: { az: 0.35, el: 0.5, dist: 100, tx: 408, tz: 12, ty: 3 } }],
  };

  /* ---------- set-up ---------- */
  function init(canvas) {
    try { if (!window.THREE) throw 0; gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); } catch (e) { return false; }
    ok = true; gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(42, 2, 0.5, 900);
    hemi = new THREE.HemisphereLight(0xffffff, 0x667070, 0.8); scene.add(hemi); sun = new THREE.DirectionalLight(0xffffff, 0.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006;
    const sc = sun.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 400; sc.updateProjectionMatrix(); scene.add(sun); scene.add(sun.target);
    root = new THREE.Group(); scene.add(root);
    _b = new THREE.Matrix4(); _l = new THREE.Matrix4(); _m = new THREE.Matrix4(); _p = new THREE.Vector3(); _q = new THREE.Quaternion(); _s = new THREE.Vector3(); _e = new THREE.Euler(); _zero = new THREE.Matrix4().makeScale(0, 0, 0); tmpC = new THREE.Color();
    cols = STATE_COL.map(c => new THREE.Color(c)); colMask = new THREE.Color(0x8fd0ee); colInk = new THREE.Color(0xffffff); colSick = new THREE.Color(0xb9c7a0); colGrey = new THREE.Color(0x70777a); colSel = new THREE.Color(0xffc93c); colShield = new THREE.Color(0xd9f1ff); colGlove = new THREE.Color(0x9fd8ff); colBreath = new THREE.Color(0x8ec5ff); colViral = new THREE.Color(0x4cff2e); colDoseLo = new THREE.Color(0xffd43b); colDoseHi = new THREE.Color(0xff3b30); colPPE = new THREE.Color(0x74c0fc); colBreach = new THREE.Color(0xff3b30); colArcLo = new THREE.Color(0x6b5a3a); colArcHi = new THREE.Color(0xff922b); colPass = new THREE.Color(0xffe066); tmpC2 = new THREE.Color(); BAGS = [0xe74c3c, 0x2e86de, 0x27ae60, 0xf1c40f].map(c => new THREE.Color(c));
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3600), 3)); lg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3600), 3));
    lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false })); lines.frustumCulled = false; lines.renderOrder = 5; scene.add(lines);
    // vaccinated badges: one point per person, drawn with a round blue "tick" texture
    const bc = document.createElement("canvas"); bc.width = bc.height = 96; const g = bc.getContext("2d"); g.fillStyle = "#1c7ed6"; g.beginPath(); g.arc(48, 48, 40, 0, 6.283); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 7; g.stroke(); g.lineWidth = 11; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); g.moveTo(28, 50); g.lineTo(43, 64); g.lineTo(70, 34); g.stroke();
    const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(1600 * 3), 3));
    badges = new THREE.Points(bg, new THREE.PointsMaterial({ size: 1.5, map: new THREE.CanvasTexture(bc), transparent: true, alphaTest: 0.3, sizeAttenuation: true })); badges.frustumCulled = false; scene.add(badges);
    // cough clouds: a small pool, reused
    const dc = document.createElement("canvas"); dc.width = dc.height = 64; const dg = dc.getContext("2d"), gr = dg.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); dg.fillStyle = gr; dg.fillRect(0, 0, 64, 64); const dot = new THREE.CanvasTexture(dc);
    for (let c = 0; c < 8; c++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; m.renderOrder = 4; scene.add(m); flashes.push({ m, life: 0, i: 0 }); }
    for (let c = 0; c < 16; c++) { const n = 110, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c1 = new THREE.Color(0x9dff3a), c2 = new THREE.Color(0x2fd95a);
      for (let k = 0; k < n; k++) { const t = Math.pow(Math.random(), 0.7), r = t * 0.62 * Math.sqrt(Math.random()), a = Math.random() * 6.283; pos.set([Math.cos(a) * r, Math.sin(a) * r * 0.8 - t * t * 0.18, t], k * 3); const cc = c1.clone().lerp(c2, t); col.set([cc.r, cc.g, cc.b], k * 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.9, map: dot, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, depthTest: false, sizeAttenuation: true })); p.frustumCulled = false; p.visible = false; p.renderOrder = 6; scene.add(p);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x5cf03c, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); cone.geometry.rotateX(-Math.PI / 2); cone.geometry.translate(0, 0, 0.5); cone.visible = false; cone.renderOrder = 5; scene.add(cone);
      clouds.push({ p, cone, life: 0, i: -1 }); }
    controls(canvas); return true;
  }
  function setTheme(isDark) { dark = isDark; if (ok && envKey) applyView(); }
  function load(key, simRef) {
    if (!ok) return; envKey = key; sim = simRef; seedR = 7; overflowG = null; guardG = null; lamps = []; pending = []; fogs = []; roadG = null; curtainG = null; evT = -1; evK = -1;
    while (root.children.length) { const g = root.children.pop(); g.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }); }
    VIEWS[key].forEach((v, k) => { G = new THREE.Group(); G.position.x = v.off; root.add(G); BUILD[v.build](); if (k === 0 && ENVS[key].type === "walk") poiProps(ENVS[key]); if (k === 1 && key === "hospital") { const Z = ENVS[key].zones[1]; for (const q of ENVS[key].ypois) if (q.kind === "bench") benchProp(Z.ox + q.x - v.off, Z.oz + q.z, 0); }
      G.traverse(m => { if (m.isMesh) { m.castShadow = !m.userData.ns && !m.userData.flat; m.receiveShadow = true; } });
      const env = ENVS[key]; (env.phys && env.phys.rooms || []).forEach((r, q) => { if (r.zone !== v.zone) return; const Z = env.zones[r.zone], cab = r.cabin, w = cab ? 6.6 : r.x1 - r.x0, d = cab ? 25 : r.z1 - r.z0, hgt = cab ? 4.6 : 5.5, cx = cab ? 0 : Z.ox + (r.x0 + r.x1) / 2 - v.off, cz = cab ? 0 : Z.oz + (r.z0 + r.z1) / 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), new THREE.MeshBasicMaterial({ color: 0xc8e0a0, transparent: true, opacity: 0, depthWrite: false })); m.position.set(cx, (cab ? 1.4 : 0) + hgt / 2, cz); m.renderOrder = 3; m.userData.ns = 1; G.add(m); fogs.push({ m, q, half: cab ? 0.02 : 0.15 / Math.sqrt(r.V), max: cab ? 0.55 : 0.22 }); }); });
    buildPeople(); setView(0, true);
  }
  function setSim(simRef) { sim = simRef; buildPeople(); }
  function setView(k, resetCam) { viewIdx = Math.min(k, VIEWS[envKey].length - 1); if (resetCam !== false) { Object.assign(cam, VIEWS[envKey][viewIdx].cam, { follow: -1 }); cam.base = cam.dist; } applyView(); }
  function applyView() { const v = VIEWS[envKey][viewIdx]; root.children.forEach((g, k) => g.visible = k === viewIdx);
    const night = !!v.night, sky = new THREE.Color(v.sky); scene.background = sky; scene.fog = new THREE.Fog(sky, 240, 640);
    hemi.intensity = v.night ? 0.5 : night ? 0.6 : v.indoor ? 0.8 : 1.0; hemi.color.set(night ? 0x9fb4ff : 0xffffff); sun.intensity = v.night ? 0.28 : night ? 0.32 : v.indoor ? 0.4 : 0.7;
    sun.position.set(v.off + 70, 120, 60); sun.target.position.set(v.off, 0, 0); }
  const skyDay = new THREE.Color(), skyNight = new THREE.Color("#0d1730"), skyNow = new THREE.Color();
  function daylight(frac) { const v = VIEWS[envKey][viewIdx]; if (v.indoor) { for (const l of lamps) { if (l.light) l.light.intensity = 0; } return; } const h = sim.t % 24 + frac, f = h < 5 ? 0 : h < 6.5 ? (h - 5) / 1.5 : h < 17.5 ? 1 : h < 19.5 ? 1 - (h - 17.5) / 2 : 0;
    skyDay.set(v.sky); skyNow.copy(skyNight).lerp(skyDay, f); scene.background.copy(skyNow); scene.fog.color.copy(skyNow); hemi.intensity = 0.34 + 0.66 * f; sun.intensity = 0.08 + 0.62 * f; hemi.color.setHex(f < 0.5 ? 0x9fb4ff : 0xffffff);
    const on = f < 0.45; for (const l of lamps) { l.b.material.color.setHex(on ? 0xfff3c2 : 0xe9e9e2); l.glow.material.opacity = on ? 0.38 : 0; if (l.light) l.light.intensity = on && l.g.visible ? 1.25 : 0; } }
  /* guards at the entrance: a static figure per guard, dressed by type */
  function setGuards(nGuards, type) { if (!ok || !envKey) return; if (guardG) { guardG.parent.remove(guardG); guardG = null; } const env = ENVS[envKey]; if (!nGuards || env.type !== "walk") return;
    const keep = G, Z = env.zones[0], col = { bhw: [0xf7f9f9, 0x2ed9a3, 0x2b3440], police: [0x1c2b5a, 0x1c2b5a, 0x1c2b5a], soldier: [0x55602f, 0x4a5428, 0x55602f] }[type] || [0xf7f9f9, 0x2ed9a3, 0x2b3440];
    guardG = new THREE.Group(); root.children[0].add(guardG); G = guardG;
    for (let k = 0; k < nGuards; k++) { const g = grp(Z.ox + env.entrance.x + (k - (nGuards - 1) / 2) * 3.4 + (k % 2 ? 4.5 : -4.5), Z.oz + env.entrance.z - 1.5, Math.PI);
      for (const sx of [-0.22, 0.22]) gbox(g, 0.4, 1.5, 0.44, col[2], sx, 0.75, 0); gbox(g, 1.05, 1.2, 0.52, col[0], 0, 2.1, 0); gbox(g, 1.1, 0.7, 0.56, col[1], 0, 2.25, 0); for (const sx of [-0.66, 0.66]) gbox(g, 0.27, 1.15, 0.3, col[0], sx, 2.1, 0);
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), mat(0xc68642)); hd.position.set(0, 3.05, 0); g.add(hd); gbox(g, 0.9, 0.28, 0.9, type === "bhw" ? 0x2ed9a3 : col[1], 0, 3.42, 0); gbox(g, 0.56, 0.34, 0.2, 0x8fd0ee, 0, 2.98, 0.3);
      gbox(g, 2.2, 1.5, 0.12, 0xf4f1e6, 2.2, 1.1, 0); gbox(g, 2.2, 0.4, 0.14, type === "bhw" ? 0x2ed9a3 : 0xc0392b, 2.2, 1.65, 0); }
    guardG.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); G = keep; }
  function resize() { if (!ok) return; const c = gl.domElement, w = c.clientWidth, h = c.clientHeight; if (!w || !h) return; gl.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }

  /* ---------- people ---------- */
  function buildPeople() {
    if (people) for (const k of PARTS) { scene.remove(people[k]); people[k].geometry.dispose(); people[k].material.dispose(); }
    const n = sim.n, mk = (geo, m, shadow) => { const im = new THREE.InstancedMesh(geo, m || mat(0xffffff), n); im.frustumCulled = false; im.castShadow = shadow !== false; im.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(im); return im; };
    const leg = new THREE.BoxGeometry(0.4, 1.5, 0.44); leg.translate(0, -0.75, 0); const arm = new THREE.BoxGeometry(0.27, 1.15, 0.3); arm.translate(0, -0.57, 0); const flat = g => { g.rotateX(-Math.PI / 2); return g; };
    people = { legL: mk(leg), legR: mk(leg), torso: mk(new THREE.BoxGeometry(0.98, 1.2, 0.52)), armL: mk(arm), armR: mk(arm), head: mk(new THREE.SphereGeometry(0.4, 14, 12)),
      hair: mk(new THREE.SphereGeometry(0.44, 14, 8, 0, 6.2832, 0, 1.7)), hairLong: mk(new THREE.BoxGeometry(0.66, 0.85, 0.22)), skirt: mk(new THREE.CylinderGeometry(0.42, 0.72, 0.95, 10)), mask: mk(new THREE.BoxGeometry(0.56, 0.34, 0.2)),
      shield: mk(new THREE.BoxGeometry(0.72, 0.62, 0.05), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }), false), bag: mk(new THREE.BoxGeometry(0.5, 0.62, 0.3)), wchair: mk(new THREE.BoxGeometry(1.15, 1.25, 0.14), mat(0x39424e)), wheelL: mk(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14).rotateZ(Math.PI / 2), mat(0x1b1e20)), wheelR: mk(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14).rotateZ(Math.PI / 2), mat(0x1b1e20)),
      ring: mk(flat(new THREE.RingGeometry(0.62, 0.92, 20)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), false),
      dring: mk(flat(new THREE.RingGeometry(2.2, 2.4, 40)), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.85 }), false),
      marker: mk(new THREE.OctahedronGeometry(0.38, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), false),
      plume: mk(new THREE.ConeGeometry(0.5, 1.8, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 0.9), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }), false),
      dosering: mk(flat(new THREE.RingGeometry(1.0, 1.22, 28)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), false),
      aura: mk(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }), false) };
    people.plume.renderOrder = 4; people.aura.renderOrder = 4;
    const L = (i, k) => sim.look[i * 4 + k];
    Object.assign(people, { wx: new Float32Array(n), wz: new Float32Array(n), ph: new Uint8Array(n), yaw: new Float32Array(n), phase: new Float32Array(n), sx: new Float32Array(n), sz: new Float32Array(n), h: new Float32Array(n), longHair: new Uint8Array(n), skirtOn: new Uint8Array(n), skin: [], hairC: [], shirt: [], pants: [], vis: new Uint8Array(n), pose: new Uint8Array(n), act: new Uint8Array(n), voc: new Uint8Array(n), kyaw: new Float32Array(n), zone: new Uint8Array(n), dose: new Float32Array(n), breachT: new Float32Array(n) });
    keyFields(0);
    for (let i = 0; i < n; i++) { const g = sim.gender[i], a = sim.ageGroup[i], t = sim.env.type, r = sim.role[i], uni = t === "hospital" ? [0, 0xf7f9f9, 0x66c2b0, [0x1f2a55, 0xe8813a, 0xd98ab0][sim.sub[i]], 0xbfd9ee, 0][r] : t === "walk" && r === 2 ? 0xd9482b : t === "jeep" && r === 3 ? 0xf4f1e6 : 0, staff = !!uni;
      people.skin.push(new THREE.Color(SKIN[Math.floor(L(i, 0) * 5)])); people.hairC.push(new THREE.Color(a === 3 ? 0xc9c9c9 : HAIR[Math.floor(L(i, 1) * 4)]));
      people.shirt.push(new THREE.Color(staff ? uni : SHIRT[Math.floor(L(i, 2) * 10)])); people.pants.push(new THREE.Color(t === "hospital" && (r === 2 || r === 4) ? uni : PANTS[Math.floor(L(i, 3) * 6)]));
      people.h[i] = (a === 0 ? 0.66 + 0.2 * L(i, 1) : a === 3 ? 0.93 : 0.96 + 0.1 * L(i, 2)) * (g ? 0.95 : 1.03); people.longHair[i] = g && L(i, 3) < 0.75 ? 1 : 0; people.skirtOn[i] = g && !staff && L(i, 0) < 0.4 ? 1 : 0;
      const w = worldPos(i, 1); people.sx[i] = w[0]; people.sz[i] = w[1]; people.yaw[i] = sim.hd[i]; }
  }
  let phase = 2;   // set by worldPos: 1 moving between key frames, 2 standing / at the activity
  /* The engine records everyone every 5 simulated minutes (13 key frames per hour, sub-step 0..12).
     The renderer plays the hour by interpolating between neighbouring key frames, so walking speed on
     screen is the engine's real walking speed and legs swing only while a person actually covers ground. */
  function kAt(f) { const x = Math.max(0, Math.min(SUBN, f * SUBN)), k = Math.min(SUBN - 1, Math.floor(x)); return [k, x - k, Math.round(x)]; }
  function keyFields(f) { const K = sim.K, n = sim.n; if (!K) { for (let i = 0; i < n; i++) { people.pose[i] = sim.pose[i]; people.act[i] = sim.act[i]; people.voc[i] = sim.voc[i]; people.kyaw[i] = sim.yaw[i]; people.zone[i] = sim.zone[i]; people.dose[i] = sim.doseDay[i]; } return; }
    const kn = kAt(f)[2], o = kn * n; for (let i = 0; i < n; i++) { people.pose[i] = K.pose[o + i]; people.act[i] = K.act[o + i]; people.voc[i] = K.voc[o + i]; people.kyaw[i] = K.yaw[o + i]; people.zone[i] = K.zone[o + i]; people.dose[i] = K.dose[o + i]; } }
  function keyVis(i, f) { const K = sim.K; return K ? K.vis[kAt(f)[2] * sim.n + i] : !sim.away[i]; }
  function worldPos(i, f) { const K = sim.K, n = sim.n; phase = 2;
    if (!K) { const Z = sim.env.zones[sim.zone[i]]; return [Z.ox + sim.x[i], Z.oz + sim.z[i]]; }
    const [k, t] = kAt(f), a = k * n + i, b = a + n; let x = K.x[a], z = K.z[a], zn = K.zone[a];
    if (K.vis[a] && K.vis[b] && K.zone[b] === zn) { const dx = K.x[b] - x, dz = K.z[b] - z, d2 = dx * dx + dz * dz; if (d2 < 900) { x += dx * t; z += dz * t; if (d2 > 0.01) phase = 1; } else if (t > 0.5) { x = K.x[b]; z = K.z[b]; } }
    else if (!K.vis[a] || t > 0.5 && K.vis[b]) { x = K.x[b]; z = K.z[b]; zn = K.zone[b]; }
    const Z = sim.env.zones[zn]; return [Z.ox + x, Z.oz + z]; }
  function part(mesh, i, x, y, z, rx, sx, sy, sz) { _e.set(rx, 0, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx || 1, sy || 1, sz || 1); _l.compose(_p, _q, _s); _m.multiplyMatrices(_b, _l); mesh.setMatrixAt(i, _m); }
  function shownState(i) { const s = sim.state[i]; return s === INFECTIOUS && sim.silent[i] && !sim.revealed[i] && !opt.truth ? HEALTHY : s; }
  function updatePeople(frac, time) {
    const n = sim.n, v = VIEWS[envKey][viewIdx], bpos = badges.geometry.attributes.position.array; let nb = 0; const lowBed = sim.env.type !== "hospital"; keyFields(frac);
    // pass 1: where everyone is this instant; then keep standing people a small step apart so nobody merges into another
    const live = []; for (let i = 0; i < n; i++) { const hidden = !keyVis(i, frac) || sim.state[i] === DECEASED || people.zone[i] !== v.zone; people.vis[i] = hidden ? 0 : 1; const w = worldPos(i, hidden ? 1 : frac); people.wx[i] = w[0]; people.wz[i] = w[1]; people.ph[i] = phase; if (!hidden && people.pose[i] !== 2 && sim.env.type !== "jeep" && !(people.pose[i] === 1 && phase === 2)) live.push(i); }
    if (live.length > 1) for (let pass = 0; pass < 4; pass++) { const cell = 1.6, grid = new Map(), MIN = 1.25; for (const i of live) { const key = Math.floor(people.wx[i] / cell) * 4096 + Math.floor(people.wz[i] / cell); const g = grid.get(key); if (g) g.push(i); else grid.set(key, [i]); }
      for (const i of live) { const cx = Math.floor(people.wx[i] / cell), cz = Math.floor(people.wz[i] / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const g = grid.get((cx + a) * 4096 + cz + b); if (!g) continue; for (const j of g) { if (j <= i) continue; let dx = people.wx[j] - people.wx[i], dz = people.wz[j] - people.wz[i], d = Math.hypot(dx, dz); if (d >= MIN) continue; if (d < 1e-3) { const an = (i * 2.399) % 6.283; dx = Math.cos(an); dz = Math.sin(an); d = 1; } const push = Math.min(0.25, (MIN - d) / 2 / (d || 1)); people.wx[i] -= dx * push; people.wz[i] -= dz * push; people.wx[j] += dx * push; people.wz[j] += dz * push; } } } }
    for (let i = 0; i < n; i++) {
      const st = sim.state[i], hidden = !people.vis[i];
      if (hidden) { for (const k of PARTS) people[k].setMatrixAt(i, _zero); people.sx[i] = people.wx[i]; people.sz[i] = people.wz[i]; continue; }
      const wx = people.wx[i], wz = people.wz[i], dx = wx - people.sx[i], dz = wz - people.sz[i], mv0 = Math.hypot(dx, dz), mv = mv0 > 4 ? 0 : mv0, ph = people.ph[i], pose = people.pose[i] === 1 && ph !== 2 && sim.env.type !== "jeep" && !sim.wheel[i] ? 0 : people.pose[i], h = people.h[i], g = sim.gender[i];
      const fixed = pose > 0 || sim.env.type === "jeep";
      if (fixed) people.yaw[i] = people.kyaw[i]; else if (mv <= 0.003) { let dy = people.kyaw[i] - people.yaw[i]; while (dy > Math.PI) dy -= 6.2832; while (dy < -Math.PI) dy += 6.2832; people.yaw[i] += dy * 0.2; } else { let dy = Math.atan2(dx, dz) - people.yaw[i]; while (dy > Math.PI) dy -= 6.2832; while (dy < -Math.PI) dy += 6.2832; people.yaw[i] += dy * 0.25; people.phase[i] += Math.min(mv, 1.2) * 1.6; }
      people.sx[i] = wx; people.sz[i] = wz;
      const sick = st === INFECTIOUS && !sim.silent[i] && sim.tInfectious[i] >= 12, walking = mv > 0.003 && pose === 0, standing = pose === 0 && !walking && sim.env.type !== "jeep", sw = walking ? Math.sin(people.phase[i]) * (sick ? 0.4 : 0.7) : standing ? Math.sin(time * 1.7 + i * 1.9) * 0.12 : sim.env.type === "jeep" && pose === 1 ? Math.sin(time * 2.2 + i * 1.3) * 0.03 : 0;
      const vo = people.voc[i], talk = standing && vo >= 1 && Math.sin(time * 0.9 + i * 2.3) > -0.4, shout = standing && vo === 2;
      const buying = standing && ph === 2 && people.act[i] === 1;
      const jeepRide = sim.env.type === "jeep" && pose === 1;
      const seatedSway = jeepRide ? Math.sin(time * 2.2 + i * 1.3) * 0.04 : 0;
      const seatedHead = jeepRide ? Math.sin(time * 1.1 + i * 1.7) * 0.12 : 0;
      const standingSway = standing ? Math.sin(time * 1.4 + i * 1.9) * 0.05 : 0;
      const py = pose === 2 ? (lowBed ? 0.95 : 1.75) : pose === 1 && sim.env.type === "jeep" ? 1.35 : 0;
      if (pose === 2) { _e.set(-Math.PI / 2, people.yaw[i], 0, "YXZ"); _q.setFromEuler(_e); _p.set(wx, py + 0.32 * h, wz); }
      else { _e.set(sick ? 0.16 : (seatedSway || standingSway), people.yaw[i] + seatedHead, 0, "YXZ"); _q.setFromEuler(_e); _p.set(wx, py - (pose === 1 ? 0.72 * h : 0), wz); }
      _s.set(h, h, h); _b.compose(_p, _q, _s);
      const tw = g ? 0.86 : 1.05, lw = pose === 1 ? -1.2 : sw, aw = pose === 1 ? -0.5 : -sw;
      part(people.legL, i, -0.22, 1.5, 0, lw); part(people.legR, i, 0.22, 1.5, 0, pose === 1 ? -1.2 : -lw); part(people.torso, i, 0, 2.1, 0, 0, tw);
      part(people.armL, i, -0.62 * tw, 2.66, 0, aw); part(people.armR, i, 0.62 * tw, 2.66, 0, pose === 1 ? -0.5 : shout ? -2.4 + Math.sin(time * 4 + i) * 0.3 : buying ? -0.85 + Math.sin(time * 3 + i) * 0.15 : talk ? -1.0 + Math.sin(time * 6 + i) * 0.35 : -aw); part(people.head, i, 0, 3.05, 0, 0); part(people.hair, i, 0, 3.07, -0.03, -0.25);
      if (people.longHair[i]) part(people.hairLong, i, 0, 2.78, -0.27, 0); else people.hairLong.setMatrixAt(i, _zero);
      if (people.skirtOn[i]) part(people.skirt, i, 0, 1.42, 0, 0); else people.skirt.setMatrixAt(i, _zero);
      if (sim.masked(i)) part(people.mask, i, 0, 2.98, 0.3, 0); else people.mask.setMatrixAt(i, _zero);
      if (sim.shielded(i)) part(people.shield, i, 0, 3.06, 0.5, 0); else people.shield.setMatrixAt(i, _zero);
      if (sim.bag[i] && pose !== 2) part(people.bag, i, 0.78 * tw, 1.55, 0.1, 0); else people.bag.setMatrixAt(i, _zero);
      if (sim.wheel[i] && pose === 1) { part(people.wchair, i, 0, 1.75, -0.42, 0); part(people.wheelL, i, -0.68, 1.34, -0.1, 0); part(people.wheelR, i, 0.68, 1.34, -0.1, 0); } else { people.wchair.setMatrixAt(i, _zero); people.wheelL.setMatrixAt(i, _zero); people.wheelR.setMatrixAt(i, _zero); }
      const ss = shownState(i), sc = cols[ss], contagious = (opt.truth ? st : ss) === INFECTIOUS || (opt.truth ? st : ss) === SEVERE;
      // breath plume: shows the voice level the engine used (talking 30, shouting 150 quanta/h); greenish when the speaker is contagious
      if (vo >= 1 && pose !== 2) { const pl = (vo === 2 ? 2.3 : 1.15) * (sim.masked(i) ? 0.45 : 1) * (0.75 + 0.25 * Math.sin(time * 5 + i * 1.7)), wd = vo === 2 ? 1.25 : 0.9; part(people.plume, i, 0, 2.98, 0.32, -0.08, wd, wd, pl); people.plume.setColorAt(i, contagious ? colViral : colBreath); } else people.plume.setMatrixAt(i, _zero);
      _b.makeTranslation(wx, py && pose !== 2 ? py : 0, wz);
      if (pose === 2 || sim.env.type === "jeep" && pose === 1) people.ring.setMatrixAt(i, _zero); else { const rs = i === sel ? 2 + 0.25 * Math.sin(time * 5) : 1; part(people.ring, i, 0, i === sel ? 0.09 : 0.06, 0, 0, rs, 1, rs); }
      if (pose === 0 && sim.P.dist > 0 && sim.distancing(i)) part(people.dring, i, 0, 0.07, 0, 0); else people.dring.setMatrixAt(i, _zero);
      // dose ring: the dose breathed in so far today, as a chance of infection (yellow small, red large)
      const ch = 1 - Math.exp(-people.dose[i]); if (opt.dose && ch > 0.01 && (st === HEALTHY || st === RECOVERED) && pose !== 2) { const u = Math.min(1, ch * 4); part(people.dosering, i, 0, 0.08, 0, 0, 1 + u * 0.6, 1, 1 + u * 0.6); people.dosering.setColorAt(i, tmpC.copy(colDoseLo).lerp(colDoseHi, u)); } else people.dosering.setMatrixAt(i, _zero);
      // N95 / PPE aura for ward staff; red while a PPE breach is happening
      if (sim.ppe[i] && pose === 0) { const br = time < people.breachT[i]; part(people.aura, i, 0, 2.2, 0, 0, 1.25, 2.3, 1.25); people.aura.setColorAt(i, br ? colBreach : colPPE); } else people.aura.setMatrixAt(i, _zero);
      if (ss === EXPOSED || ss === INFECTIOUS || ss === SEVERE || i === sel) { const top = py + (pose === 1 ? 3.6 : pose === 2 ? 2.2 : 4.3) * h + 0.15 * Math.sin(time * 3 + i); _e.set(0, time * 1.5, 0); _q.setFromEuler(_e); _p.set(wx, top, wz); const ms = i === sel ? 1.7 : ss === INFECTIOUS || ss === SEVERE ? 1.25 : 0.9; _s.set(ms, ms * 1.3, ms); _m.compose(_p, _q, _s); people.marker.setMatrixAt(i, _m); } else people.marker.setMatrixAt(i, _zero);
      const sev = st === SEVERE, shirt = opt.tint ? sc : people.shirt[i], pants = opt.tint ? tmpC.copy(sc).multiplyScalar(0.72) : people.pants[i], skin = sev ? colSick : people.skin[i];
      people.torso.setColorAt(i, shirt); people.armL.setColorAt(i, shirt); people.armR.setColorAt(i, shirt); people.skirt.setColorAt(i, shirt);
      const lc = people.skirtOn[i] && !opt.tint ? skin : pants; people.legL.setColorAt(i, lc); people.legR.setColorAt(i, lc);
      people.wchair.setColorAt(i, colGrey); people.wheelL.setColorAt(i, colGrey); people.wheelR.setColorAt(i, colGrey); people.shield.setColorAt(i, colShield); people.bag.setColorAt(i, BAGS[i % 4]); if (sim.ppe[i] && !opt.tint) { people.armL.setColorAt(i, colGlove); people.armR.setColorAt(i, colGlove); }
      people.head.setColorAt(i, skin); people.hair.setColorAt(i, people.hairC[i]); people.hairLong.setColorAt(i, people.hairC[i]); people.mask.setColorAt(i, colMask);
      people.ring.setColorAt(i, i === sel ? colSel : sc); people.dring.setColorAt(i, colInk); people.marker.setColorAt(i, i === sel && !(ss === EXPOSED || ss === INFECTIOUS || ss === SEVERE) ? colInk : sc);
      if (sim.vaccinated[i] && nb < 1600) { bpos[nb * 3] = wx + 0.8; bpos[nb * 3 + 1] = py + (pose === 1 ? 3.3 : pose === 2 ? 1.6 : 3.9) * h; bpos[nb * 3 + 2] = wz; nb++; }
    }
    for (const k of PARTS) { people[k].instanceMatrix.needsUpdate = true; if (people[k].instanceColor) people[k].instanceColor.needsUpdate = true; }
    badges.geometry.setDrawRange(0, nb); badges.geometry.attributes.position.needsUpdate = true;
    // lines: active transmission links (optional) and the selected person's chain
    const pos = lines.geometry.attributes.position.array, col = lines.geometry.attributes.color.array; let q = 0; const red = cols[INFECTIOUS];
    const seg = (a, b, c) => { if (q >= 600 || !people.vis[a] || !people.vis[b]) return; pos.set([people.sx[a], 3.1 * people.h[a], people.sz[a], people.sx[b], 3.1 * people.h[b], people.sz[b]], q * 6); col.set([c.r, c.g, c.b, c.r, c.g, c.b], q * 6); q++; };
    if (opt.contacts) { for (const c of sim.contacts) seg(c.a, c.b, c.inf ? red : colInk); }
    if (opt.air && sim.kev) { const e = sim.kev[kAt(frac)[2]]; if (e) { let m = 0; for (const [a, b, c, pass] of e.near) { if (c < 0.004 || m++ > 40) continue; seg(a, b, tmpC2.copy(colArcLo).lerp(colArcHi, Math.min(1, c * 25))); } for (const [a, b] of e.pass) seg(a, b, colPass); } }
    if (opt.links) for (let j = 0; j < n; j++) { const a = sim.infBy[j]; if (a >= 0 && sim.infections[j]) seg(a, j, red); }
    if (sel >= 0 && sel < n) { let j = sel, gd = 0; while (sim.infBy[j] >= 0 && gd++ < n) { seg(sim.infBy[j], j, colInk); j = sim.infBy[j]; } for (const kd of sim.kids[sel] || []) seg(sel, kd, red); }
    lines.geometry.setDrawRange(0, q * 2); lines.geometry.attributes.position.needsUpdate = true; lines.geometry.attributes.color.needsUpdate = true;
  }
  /* a cough: shown only when the engine recorded a transmission from a to b */
  const AIRBORNE = { air: 1, pass: 1, wait: 1, home: 1, seed: 1, import: 1 };   // routes with no visible cough: shared room air, a brief pass, or off-scene
  const stats = { cough: 0, sneeze: 0, airOnly: 0, dropped: 0 };
  function cough(a, b, sub, kind) { if (ok && people) pending.push({ a, b, t: sim.t, s: sub || 0, kind: kind || "", exp: performance.now() + 9000 }); }
  function puff(i, bx, bz, big) {
    const c = clouds.find(k => k.life <= 0) || clouds[0], ax = people.wx[i], az_ = people.wz[i], y = mouthY(i);
    c.i = i; c.dx = bx - ax; c.dz = bz - az_;
    for (const o of [c.p, c.cone]) { o.position.set(ax, y, az_); o.lookAt(bx, y - 0.3, bz); o.visible = true; }
    c.len = big ? Math.min(10, Math.max(4, Math.hypot(bx - ax, bz - az_) + 1.5)) : 4;
    c.life = c.max = big ? 210 : 150;
    const f = flashes.find(q => q.life <= 0); if (f) { f.i = i; f.life = 80; f.m.visible = true; f.m.material.color.setHex(0x5cf03c); }
  }
  function mouthY(i) { const p = people.pose[i], seated = p === 1 && people.ph[i] === 2; if (p === 2) return (sim.env.type === "hospital" ? 1.75 : 0.95) + 0.55;
    return 2.95 * people.h[i] - (seated ? 0.7 : 0) + (sim.env.type === "jeep" && seated ? 1.35 : 0); }
  function flash(i) { const f = flashes.find(k => k.life <= 0) || flashes[0]; f.i = i; f.life = 80; f.m.visible = true; f.m.material.color.setHex(0xff5d5d); }
  function updateCoughs(frac) {
    const vz = VIEWS[envKey][viewIdx].zone, now = performance.now();
    const kNow = frac * SUBN;
    pending = pending.filter(q => {
      const { a, b } = q;
      if (q.t === sim.t && kNow < q.s) return true;            // not yet: wait for the 5-minute step it happened in
      if (q.t !== sim.t || now > q.exp) { stats.dropped++; return false; }   // never draw it late, out of context
      const visA = people.vis[a] && people.zone[a] === vz, visB = people.vis[b] && people.zone[b] === vz;
      if (!visB) { stats.dropped++; return false; }
      const d = visA ? Math.hypot(people.wx[b] - people.wx[a], people.wz[b] - people.wz[a]) : 1e9;
      if (AIRBORNE[q.kind] || !visA || d > 4.5) { flash(b); stats.airOnly++; if (onCoughCb) onCoughCb(a, b, "air"); return false; }   // caught from the shared air: only the person who caught it lights up
      puff(a, people.wx[b], people.wz[b], true); flash(b); stats.cough++;
      if (people.pose[a] === 0) people.yaw[a] = Math.atan2(people.wx[b] - people.wx[a], people.wz[b] - people.wz[a]);
      if (onCoughCb) onCoughCb(a, b, "near");
      return false;
    });
    // sub-step events recorded by the engine: coughs, speech ("Bayad po", "Para po", vendor calls), PPE breaches
    if (sim.kev) { if (evT !== sim.t) { evT = sim.t; evK = -1; } const kn = Math.min(SUBN, Math.floor(kNow)); for (let k = evK + 1; k <= kn; k++) { const e = sim.kev[k]; if (!e) continue;
        for (const i of e.cough) if (people.vis[i] && people.zone[i] === vz && (stats.sneeze++, true)) puff(i, people.wx[i] + Math.sin(people.yaw[i]) * 3, people.wz[i] + Math.cos(people.yaw[i]) * 3, false);
        for (const [i, text] of e.say) if (people.vis[i] && onSayCb) onSayCb(i, text);
        for (const [i, p] of e.breach) { people.breachT[i] = performance.now() / 1000 + 4; if (onBreachCb && people.vis[i]) onBreachCb(i, p); } }
      evK = Math.max(evK, kn); }
    for (const f of flashes) {
      if (f.life <= 0) continue;
      f.life--;
      const t = 1 - f.life / 80, s = 1 + t * 6;
      f.m.position.set(people.wx[f.i], 0.12, people.wz[f.i]);
      f.m.scale.set(s, s, s);
      f.m.material.opacity = (1 - t) * 0.9;
      if (f.life <= 0 || !people.vis[f.i]) { f.m.visible = false; f.life = 0; }
    }
  }
  function updateClouds() {
    for (const c of clouds) {
      if (c.life <= 0) continue;
      c.life--;
      const t = 1 - c.life / (c.max || 90), grow = Math.min(1, t * 3), s = c.len * grow;
      c.p.scale.set(s * 0.9, s * 0.9, s);
      c.cone.scale.set(s, s, s);
      c.p.material.opacity = Math.min(1, c.life / 40);
      c.cone.material.opacity = Math.min(1, c.life / 40) * 0.6;
      if (c.i >= 0 && people.vis[c.i]) { const y = mouthY(c.i); c.p.position.set(people.sx[c.i], y + (c.max - c.life) * 0.004, people.sz[c.i]); c.cone.position.set(people.sx[c.i], y, people.sz[c.i]); }
      else if (c.i >= 0) c.life = Math.min(c.life, 1);   // the cougher left the view: the cloud goes with them
      if (c.life <= 0) { c.p.visible = false; c.cone.visible = false; c.i = -1; }
    }
  }

  /* ---------- camera ---------- */
  let sel = -1, onPick = null;
  function controls(c) { let drag = null;
    c.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, az: cam.az, el: cam.el, tx: cam.tx, tz: cam.tz, pan: e.shiftKey || e.button === 2, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove", e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; if (!drag.moved) return;
      if (drag.pan) { const s = cam.dist / 700, ca = Math.cos(cam.az), sa = Math.sin(cam.az); cam.tx = drag.tx - (dx * ca + dy * sa) * s; cam.tz = drag.tz - (-dx * sa + dy * ca) * s; cam.follow = -1; }
      else { cam.az = drag.az - dx * 0.008; cam.el = Math.min(1.5, Math.max(0.06, drag.el + dy * 0.006)); } });
    c.addEventListener("pointerup", e => { if (drag && !drag.moved) { const i = pick(e); if (onPick) onPick(i); } drag = null; }); c.addEventListener("pointercancel", () => drag = null);
    c.addEventListener("contextmenu", e => e.preventDefault());
    c.addEventListener("wheel", e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false }); }
  function pick(e) { const b = gl.domElement.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, v = new THREE.Vector3(); let best = -1, bd = 1e9;
    for (let i = 0; i < sim.n; i++) { if (!people.vis[i]) continue; v.set(people.sx[i], 2 * people.h[i] + (sim.pose[i] === 2 ? 0 : 0), people.sz[i]).project(camera); if (v.z > 1) continue; const d = Math.hypot((v.x + 1) / 2 * b.width - x, (1 - v.y) / 2 * b.height - y); if (d < 40 && d < bd) { bd = d; best = i; } } return best; }
  function zoom(f) { cam.dist = Math.min(cam.base * 1.6, Math.max(9, cam.dist * f)); }
  function zoomLevel() { return cam.base / cam.dist; }
  function setZoom(level) { cam.dist = Math.min(cam.base * 1.6, Math.max(9, cam.base / level)); }
  function preset(name) { const b = VIEWS[envKey][viewIdx].cam; cam.follow = -1; if (name === "top") Object.assign(cam, b, { el: 1.5 }); else if (name === "street") Object.assign(cam, b, { el: 0.12, dist: b.dist * 0.5 }); else if (name === "follow") { cam.follow = sel; } else Object.assign(cam, b); }
  function focus(i) { if (!people || i < 0) return; const z = sim.zone[i], k = VIEWS[envKey].findIndex(v => v.zone === z); if (k >= 0 && k !== viewIdx && !sim.away[i]) setView(k); if (!sim.away[i]) { const w = worldPos(i, 1); cam.tx = w[0]; cam.tz = w[1]; cam.dist = Math.min(cam.dist, 26); cam.follow = -1; } }
  function render(frac) {
    if (!ok || !sim || !people) return; const c = gl.domElement; if (!c.clientWidth) return; if (c.width !== Math.round(c.clientWidth * gl.getPixelRatio()) || c.height !== Math.round(c.clientHeight * gl.getPixelRatio())) resize();
    const time = performance.now() / 1000; updatePeople(frac, time); updateCoughs(frac); updateClouds(); daylight(frac);
    if (sim.kC && fogs.length) { const k = kAt(frac), R = sim.rooms.length || 1; for (const f of fogs) { const c0 = sim.kC[k[0] * R + f.q], c1 = sim.kC[(k[0] + 1) * R + f.q], c = c0 + (c1 - c0) * k[1]; f.m.material.opacity = opt.air ? f.max * c / (c + f.half) : 0; f.m.visible = f.m.material.opacity > 0.01; } }
    if (roadG) { const mv = sim.jeepMoving && sim.env.type === "jeep" && sim.riders && sim.riders.length && sim.jeepMoving(kAt(frac)[2]); if (mv) roadG.position.z = (roadG.position.z + 0.45) % 9; }
    if (curtainG) curtainG.visible = !sim.P.windowsOpen;
    if (overflowG) { let on = false; for (const b of sim.beds) if (b.overflow && b.by >= 0) { on = true; break; } overflowG.visible = true; }
    let { tx, tz, ty, az, el, dist } = cam;
    if (cam.follow >= 0 && cam.follow < sim.n && people.vis[cam.follow]) { tx = cam.tx = people.sx[cam.follow]; tz = cam.tz = people.sz[cam.follow]; ty = 3; dist = Math.min(dist, 20); el = Math.min(el, 0.35); }
    camera.position.set(tx + dist * Math.sin(az) * Math.cos(el), ty + dist * Math.sin(el), tz + dist * Math.cos(az) * Math.cos(el)); camera.lookAt(tx, ty, tz); gl.render(scene, camera);
  }
  function camInfo() { return { tx: cam.tx, tz: cam.tz, dist: cam.dist, off: VIEWS[envKey][viewIdx].off }; }
  function lookAt(x, z) { cam.tx = x; cam.tz = z; cam.follow = -1; }
  function shadows(on) { if (ok) { gl.shadowMap.enabled = on; sun.castShadow = on; scene.traverse(m => { if (m.material) m.material.needsUpdate = true; }); } }
  function screenAt(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera), b = gl.domElement.getBoundingClientRect(); return v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 ? null : [(v.x + 1) / 2 * b.width, (1 - v.y) / 2 * b.height]; }
  return { set onCough(f) { onCoughCb = f; }, set onSay(f) { onSayCb = f; }, stats, set onBreach(f) { onBreachCb = f; }, daylightAt(h) { return h < 5 ? 0 : h < 6.5 ? (h - 5) / 1.5 : h < 17.5 ? 1 : h < 19.5 ? 1 - (h - 17.5) / 2 : 0; }, screenAt, setGuards, camInfo, lookAt, shadows, init, load, setSim, setView, setTheme, resize, render, cough, zoom, zoomLevel, setZoom, preset, focus, opt, VIEWS,
    get ok() { return ok; }, get view() { return viewIdx; }, set selected(i) { sel = i; }, get selected() { return sel; }, set onPick(f) { onPick = f; },
    screenOf(i) { if (!people || !people.vis[i]) return null; const v = new THREE.Vector3(people.sx[i], 3.6 * people.h[i], people.sz[i]).project(camera), b = gl.domElement.getBoundingClientRect(); return v.z > 1 ? null : [(v.x + 1) / 2 * b.width, (1 - v.y) / 2 * b.height]; } };
})();
