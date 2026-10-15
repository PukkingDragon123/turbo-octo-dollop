// R.O.O.M. — standard-issue kit worn over the hazmat suit: SCBA harness (padded webbing straps,
// chest strap, side-release buckles), air cylinder with valve / gauge / hazard label, demand
// regulator, the chunky corporate wristwatch, the clip-on ID badge (employee number built from
// digit quads), the embroidered shoulder patch and the hood stencil. Plus the dynamic ribbed hose.
import * as THREE from 'three';
import { clamp, lerp } from './kit.js';
import { DIM, Y, PartBuilder, torsoW, armW, hoodW } from './dollrig.js';
import { torsoPt, torsoNrm, torsoPhiX, hoodPoint, WEB, TAPE, mergeSimple } from './suit.js';
import { SACK, facePt } from './sack.js';
import { grid, gridNormals, displace, tint, solid, ensureOutward, gridArcUV, tubeR, curvePts, ribbonOn, ss, gauss, pillow } from './geom.js';
import { atlasUV, ATLAS } from './dolltex.js';

const PI = Math.PI, TAU = PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _p = V(), _n = V(), _q = new THREE.Quaternion();
const qFromN = (n, up = V(0, 1, 0)) => { const m = new THREE.Matrix4().lookAt(V(), n.clone().negate(), up); return new THREE.Quaternion().setFromRotationMatrix(m); };

// a decal grid lying on a surface: fn(u, v, outP, outN) for u, v in 0..1; region: atlas key
export function decalGrid(nu, nv, fn, region, { flipU = false } = {}) {
  const g = grid(nu, nv, (i, j, p) => fn(i / nu, j / nv, p, _n));
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); const [a, b] = atlasUV(region, flipU ? 1 - u : u, v); uv.setXY(k, a, b); }
  return g;
}
// flat decal quad (local space): w x h centred, facing +Z
export function decalQuad(w, h, region, flipU = false) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) { const [a, b] = atlasUV(region, flipU ? 1 - uv.getX(k) : uv.getX(k), uv.getY(k)); uv.setXY(k, a, b); }
  return g;
}
// remap a geometry's UVs (0..1) into an atlas region
export function toRegion(g, region) {
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) { const [a, b] = atlasUV(region, clamp(uv.getX(k), 0, 1), clamp(uv.getY(k), 0, 1)); uv.setXY(k, a, b); }
  return g;
}

// ---------------------------------------------------------------------------
// Harness straps (on the torso surface), used by every backpack
// ---------------------------------------------------------------------------
export const STRAP_X = 0.118;
export function buildStraps(B, col = WEB, { chest = true, pads = true, buckleCol = 0x232326 } = {}) {
  const off = 0.0105;
  for (const s of [-1, 1]) {
    const x = s * STRAP_X;
    // front: from the waist buckle up under the hood
    const front = (t, o) => { const y = lerp(0.49, 0.84, t); return torsoPt(torsoPhiX(x * (1 - 0.15 * t), y, true), y, off, o); };
    const frontN = (t, o) => { const y = lerp(0.49, 0.84, t); return torsoNrm(torsoPhiX(x * (1 - 0.15 * t), y, true), y, o); };
    strip(B, front, frontN, 30, 0.04, 0.0055, col);
    if (pads) strip(B, (t, o) => front(lerp(0.52, 1, t), o).addScaledVector(frontN(lerp(0.52, 1, t), _n), 0.003), (t, o) => frontN(lerp(0.52, 1, t), o), 14, 0.052, 0.009, 0x2a2b30, { bevel: 0.9 });
    // back: from the backplate up under the hood
    const back = (t, o) => { const y = lerp(0.6, 0.84, t); return torsoPt(torsoPhiX(x * 0.9, y, false), y, off, o); };
    const backN = (t, o) => { const y = lerp(0.6, 0.84, t); return torsoNrm(torsoPhiX(x * 0.9, y, false), y, o); };
    strip(B, back, backN, 14, 0.042, 0.0055, col);
    // tri-glide buckle + dangling strap end at the bottom
    const bp = front(0.06, V()), bn = frontN(0.06, V()), q = qFromN(bn);
    const buckle = new THREE.TorusGeometry(0.019, 0.0028, 6, 4, TAU); buckle.rotateZ(PI / 4).scale(1.35, 0.7, 1).applyQuaternion(q).translate(bp.x + bn.x * 0.006, bp.y, bp.z + bn.z * 0.006);
    B.skinned('metal', buckle, torsoW, 0x9a9da2);
    const tail = new THREE.BoxGeometry(0.036, 0.07, 0.003); tail.translate(0, -0.045, 0.004).applyQuaternion(q).translate(bp.x, bp.y, bp.z);
    B.skinned('tape', tail, torsoW, col);
    if (s > 0) B.info.strapR = { x, off };
    else B.info.strapL = { x, off };
  }
  if (chest) {
    const y = 0.615;
    const pts = [], nrm = [];
    for (let i = 0; i <= 14; i++) { const x = lerp(-STRAP_X, STRAP_X, i / 14); const phi = torsoPhiX(x, y, true); pts.push(torsoPt(phi, y, off + 0.004, V())); nrm.push(torsoNrm(phi, y, V())); }
    const g = ribbonOn(pts, nrm, 0.022, 0.004); solid(g, col);
    B.skinned('tape', g, torsoW);
    // side-release buckle
    const phi = torsoPhiX(0.0, y, true), bp = torsoPt(phi, y, off + 0.011, V()), q = qFromN(torsoNrm(phi, y, V()));
    const female = pillow(0.05, 0.026, 0.011); female.translate(-0.012, 0, 0).applyQuaternion(q).translate(bp.x, bp.y, bp.z);
    B.skinned('plastic', female, torsoW, buckleCol);
    const male = pillow(0.03, 0.022, 0.008); male.translate(0.022, 0, 0.001).applyQuaternion(q).translate(bp.x, bp.y, bp.z);
    B.skinned('plastic', male, torsoW, buckleCol);
  }
}
function strip(B, fnP, fnN, n, w, th, col, opts = {}) {
  const pts = [], nrm = [];
  for (let i = 0; i <= n; i++) { pts.push(fnP(i / n, V())); nrm.push(fnN(i / n, V())); }
  const g = ribbonOn(pts, nrm, w, th, opts);
  solid(g, col);
  // webbing edge stitch shading
  tint(g, (x, y, z, i) => (i % 6 === 0 || i % 6 === 5 ? 0.85 : 1));
  B.skinned('tape', g, torsoW);
  return g;
}

// ---------------------------------------------------------------------------
// Air tank (pack bone space: origin on the upper back, +Z away from the body)
// ---------------------------------------------------------------------------
export function buildTank(B, { cylCol = 0xe9e5da, plateCol = 0x1e1f23 } = {}) {
  buildStraps(B);
  // contoured backplate
  const plate = grid(12, 14, (i, j, p) => {
    const u = i / 12 - 0.5, v = j / 14 - 0.5;
    const a = u * 0.62, R = 0.36;
    p.set(Math.sin(a) * R, v * 0.34, (Math.cos(a) - 1) * R);
    const edge = Math.max(Math.abs(u) * 2, Math.abs(v) * 2);
    p.z += 0.008 * (1 - ss(0.8, 1, edge));
  });
  ensureOutward(plate, V(0, 0, -0.5)); // the face away from the body... flip below
  // make it a closed slab: front + back faces
  const back = plate.clone(); back.translate(0, 0, -0.012);
  const pi = back.index.array; for (let k = 0; k < pi.length; k += 3) { const x = pi[k + 1]; pi[k + 1] = pi[k + 2]; pi[k + 2] = x; }
  back.computeVertexNormals();
  B.rigid('pack', 'plastic', plate, plateCol);
  B.rigid('pack', 'plastic', back, plateCol);
  // rim around the plate
  const rim = []; for (let i = 0; i <= 40; i++) { const t = i / 40; const a = t * TAU; const u = Math.cos(a) * 0.5, v = Math.sin(a) * 0.5; const k = Math.max(Math.abs(u), Math.abs(v)) * 2; const uu = u / k * 0.98, vv = v / k * 0.98; const ang = uu * 0.62; rim.push(V(Math.sin(ang) * 0.36, vv * 0.34, (Math.cos(ang) - 1) * 0.36 - 0.004)); }
  B.rigid('pack', 'plastic', tubeR(rim, 0.0075, 6), plateCol);
  // cylinder
  const tz = 0.094, R = 0.084, yb = -0.17, yt = 0.14;
  const prof = [[0, yb - 0.004], [R * 0.55, yb - 0.002], [R * 0.86, yb + 0.014], [R * 0.98, yb + 0.042], [R, yb + 0.07], [R, yt - 0.05], [R * 0.97, yt - 0.02], [R * 0.82, yt + 0.012], [R * 0.5, yt + 0.03], [0.022, yt + 0.036], [0, yt + 0.036]];
  const cyl = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32);
  cyl.translate(0, 0, tz);
  tint(cyl, (x, y) => 0.96 + 0.04 * Math.sin(y * 40) * 0 - 0.1 * ss(yb + 0.05, yb, y));
  B.rigid('pack', 'plastic', cyl, cylCol);
  // label band (decal, wraps the cylinder; seam at the back against the plate)
  const band = decalGrid(32, 1, (u, v, p) => { const a = PI + (u - 0.5) * TAU * 0.999; p.set(Math.sin(a) * (R + 0.0012), lerp(-0.06, 0.03, v), tz + Math.cos(a) * (R + 0.0012)); }, 'tank');
  ensureOutward(band, V(0, -0.02, tz));
  B.rigid('pack', 'decal', band, 0xffffff);
  // clamp bands
  for (const y of [-0.105, 0.075]) {
    B.rigid('pack', 'metal', new THREE.TorusGeometry(R + 0.003, 0.0045, 5, 32).rotateX(PI / 2).translate(0, y, tz), 0x8c9096);
    B.rigid('pack', 'metal', new THREE.BoxGeometry(0.03, 0.018, 0.012).translate(R + 0.008, y, tz), 0x7c8086);
  }
  // valve: neck, body, red handwheel, gauge, outlet
  const vy = yt + 0.036;
  B.rigid('pack', 'metal', new THREE.CylinderGeometry(0.02, 0.024, 0.026, 16).translate(0, vy + 0.012, tz), 0xb8bcc2);
  B.rigid('pack', 'metal', pillow(0.05, 0.03, 0.034).translate(0, vy + 0.038, tz), 0xc6c9cd);
  const wheel = new THREE.TorusGeometry(0.022, 0.0055, 8, 22); wheel.rotateX(PI / 2).translate(0, vy + 0.064, tz);
  B.rigid('pack', 'plastic', wheel, 0xc8302a);
  for (let k = 0; k < 3; k++) B.rigid('pack', 'plastic', new THREE.BoxGeometry(0.044, 0.006, 0.006).rotateY((k / 3) * PI).translate(0, vy + 0.064, tz), 0xc8302a);
  B.rigid('pack', 'metal', new THREE.CylinderGeometry(0.006, 0.006, 0.02, 10).translate(0, vy + 0.056, tz), 0xb8bcc2);
  // side gauge (faces outward / up)
  const gq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, -0.9, 0));
  const gp = V(-0.034, vy + 0.04, tz + 0.012);
  const gcase = new THREE.CylinderGeometry(0.021, 0.021, 0.014, 22).rotateX(PI / 2); gcase.applyQuaternion(gq).translate(gp.x, gp.y, gp.z);
  B.rigid('pack', 'metal', gcase, 0x2b2c30);
  const dial = new THREE.CircleGeometry(0.0175, 22); toRegion(remapCircleUV(dial), 'gauge'); dial.translate(0, 0, 0.0075).applyQuaternion(gq).translate(gp.x, gp.y, gp.z);
  B.rigid('pack', 'decal', dial, 0xffffff);
  const glass = new THREE.TorusGeometry(0.019, 0.0028, 6, 22); glass.translate(0, 0, 0.0075).applyQuaternion(gq).translate(gp.x, gp.y, gp.z);
  B.rigid('pack', 'metal', glass, 0xd0d3d6);
  // outlet to the hose (right side)
  const outlet = new THREE.CylinderGeometry(0.009, 0.01, 0.034, 12).rotateZ(-PI / 2).translate(0.04, vy + 0.03, tz);
  B.rigid('pack', 'metal', outlet, 0xb8bcc2);
  B.info.hoseStart = { bone: 'pack', pos: V(0.058, vy + 0.03, tz), dir: V(0.8, 0.1, -0.55).normalize() };
  B.springs.pack = { k: 60, d: 5, gain: 0.014, mode: 'stand', limit: 0.3 };
  B.info.tank = true;
}
function remapCircleUV(g) {
  const P = g.attributes.position, uv = g.attributes.uv; let r = 0;
  for (let i = 0; i < P.count; i++) r = Math.max(r, Math.hypot(P.getX(i), P.getY(i)));
  for (let i = 0; i < P.count; i++) uv.setXY(i, 0.5 + P.getX(i) / (2 * r), 0.5 + P.getY(i) / (2 * r));
  return g;
}
export { remapCircleUV };

// demand regulator clipped to the right strap; returns the hose end anchor
export function buildRegulator(B) {
  const st = B.info.strapR; if (!st) return;
  const y = 0.7, x = st.x, phi = torsoPhiX(x, y, true);
  const p = torsoPt(phi, y, st.off + 0.02, V()), n = torsoNrm(phi, y, V()), q = qFromN(n);
  const body = pillow(0.046, 0.05, 0.03); body.applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('plastic', body, torsoW, 0x232428);
  const knob = new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 16).rotateX(PI / 2).translate(0, -0.004, 0.017); knob.applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('plastic', knob, torsoW, 0xc8302a);
  const clip = new THREE.BoxGeometry(0.02, 0.03, 0.004).translate(0, 0.03, -0.014); clip.applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('metal', clip, torsoW, 0x9a9da2);
  B.info.hoseEnd = { bone: 'chest', pos: p.clone().add(V(0.008, 0.03, 0)).sub(V(0, Y.chest, 0)), dir: V(0.15, 1, 0.25).normalize() };
}

// pressure gauge on the left strap
export function buildStrapGauge(B) {
  const st = B.info.strapL; if (!st) return;
  const y = 0.665, x = st.x, phi = torsoPhiX(x, y, true);
  const p = torsoPt(phi, y, st.off + 0.016, V()), n = torsoNrm(phi, y, V()), q = qFromN(n).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0)));
  const caseG = new THREE.CylinderGeometry(0.024, 0.024, 0.018, 24).rotateX(PI / 2); caseG.applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('rubber', caseG, torsoW, 0x1a1a1c);
  const dial = new THREE.CircleGeometry(0.019, 24); toRegion(remapCircleUV(dial), 'gauge'); dial.translate(0, 0, 0.0095).applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('decal', dial, torsoW, 0xffffff);
  const bez = new THREE.TorusGeometry(0.021, 0.003, 6, 24); bez.translate(0, 0, 0.0095).applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('metal', bez, torsoW, 0xc8cbce);
  // short hose from the gauge back over the shoulder
  const h0 = V(0, 0.022, -0.004).applyQuaternion(q).add(p);
  const hp = [h0, h0.clone().add(V(0.006, 0.05, 0.01)), torsoPt(torsoPhiX(x * 0.9, 0.82, true), 0.82, st.off + 0.012, V())];
  B.skinned('rubber', tubeR(curvePts(hp, 14), 0.0055, 7), torsoW, 0x1c1c1e);
}

// ---------------------------------------------------------------------------
// Wristwatch (left forearm, outer side, just above the duct tape)
// ---------------------------------------------------------------------------
export function buildWatch(B) {
  const el = 'elL', y = -DIM.fore + 0.067, r = 0.0675;
  // strap ring around the sleeve
  const strap = grid(28, 2, (i, j, p) => { const a = (i / 36) * TAU, v = j / 3; p.set(Math.cos(a) * (r + 0.0025 * Math.sin(PI * v)), y + (v - 0.5) * 0.02, Math.sin(a) * (r + 0.0025 * Math.sin(PI * v))); }, { closedU: true });
  ensureOutward(strap, V(0, y, 0));
  B.rigid(el, 'rubber', strap, 0x1d1d20);
  // chunky retro wrist terminal on the outer (-X) side (matches the first-person unit): olive
  // housing on a clamp cuff, dark bezel round the LCD, knurled dial + selector, side knob
  const cx = -(r + 0.009), OLIVE = 0x596043, TRIM = 0x26272a;
  const cuffG = grid(32, 4, (i, j, p) => { const a = (i / 32) * TAU, v = j / 4; p.set(Math.cos(a) * (r + 0.0035 + 0.0015 * Math.sin(PI * v)), y + (v - 0.5) * 0.05, Math.sin(a) * (r + 0.0035 + 0.0015 * Math.sin(PI * v))); }, { closedU: true });
  ensureOutward(cuffG, V(0, y, 0));
  B.rigid(el, 'plastic', cuffG, 0x3c4130);
  const body = pillow(0.02, 0.058, 0.06); body.translate(cx - 0.001, y, 0);
  B.rigid(el, 'plastic', body, OLIVE);
  const bezel = pillow(0.006, 0.044, 0.036); bezel.translate(cx - 0.0095, y + 0.004, 0);
  B.rigid(el, 'plastic', bezel, TRIM);
  const lcd = decalQuad(0.034, 0.026, 'lcd'); lcd.rotateY(-PI / 2).rotateX(0).translate(cx - 0.0128, y, 0);
  // orient so the text reads along the forearm (rotate 90deg in the face plane)
  lcd.translate(-cx + 0.0128, -y, 0); lcd.rotateX(PI / 2); lcd.translate(cx - 0.0128, y + 0.004, 0);
  B.rigid(el, 'decal', lcd, 0xffffff);
  // dial + selector toward the wrist, buttons toward the elbow, side knob
  B.rigid(el, 'plastic', new THREE.CylinderGeometry(0.0072, 0.0076, 0.007, 14).rotateZ(PI / 2).translate(cx - 0.0125, y - 0.022, 0.009), 0x2c2d2a);
  B.rigid(el, 'plastic', new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 6).rotateZ(PI / 2).translate(cx - 0.012, y - 0.022, -0.011), 0x2c2d2a);
  for (const [k, col] of [[-1, 0xb8322a], [0, 0xd8a432], [1, 0x8a8c84]]) B.rigid(el, 'rubber', pillow(0.004, 0.005, 0.007).translate(cx - 0.0105, y + 0.027, k * 0.009), col);
  B.rigid(el, 'plastic', new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 12).translate(cx, y, 0.033), 0x2c2d2a);
  for (const z of [-0.026, 0.026]) B.rigid(el, 'metal', new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 8).rotateZ(PI / 2).translate(cx - 0.0105, y - 0.027, z * 0.95), 0xb8bcb4);
  B.info.watch = { bone: el, pos: V(cx - 0.012, y, 0), rot: new THREE.Euler(0, -PI / 2, 0) };
}

// ---------------------------------------------------------------------------
// ID badge on the left chest (card + clip; the employee number = 4 digit quads)
// ---------------------------------------------------------------------------
export const BADGE = { x: -0.064, y: 0.7, w: 0.05, h: 0.0726 };
export function badgeFrame() {
  const phi = torsoPhiX(BADGE.x, BADGE.y, true);
  const n = torsoNrm(phi, BADGE.y, V());
  const p = torsoPt(phi, BADGE.y, 0.0135, V());
  const q = qFromN(n);
  return { p, n, q };
}
export function buildBadge(B) {
  const { p, n, q } = badgeFrame();
  const card = pillow(BADGE.w + 0.004, BADGE.h + 0.004, 0.003); card.applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('plastic', card, torsoW, 0xe8e6e0);
  const face = decalQuad(BADGE.w, BADGE.h, 'badge'); face.translate(0, 0, 0.0018).applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('decal', face, torsoW, 0xffffff);
  const clip = new THREE.BoxGeometry(0.016, 0.022, 0.004); clip.translate(0, BADGE.h / 2 + 0.006, -0.002).applyQuaternion(q).translate(p.x, p.y, p.z);
  B.skinned('metal', clip, torsoW, 0xb8bcc0);
  B.info.badge = { p, n, q };
}
// digit quads for the employee number (separate tiny geometry so it can be rewritten per avatar)
export function badgeDigitsGeo(num) {
  const { p, q } = badgeFrame();
  const parts = [];
  const str = String(num).padStart(4, '0').slice(-4);
  const dw = BADGE.w * 0.17, dh = dw * 1.8, y = BADGE.h / 2 - BADGE.h * (293 / 360);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(dw, dh);
    const d = +str[i];
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) { const [a, b] = atlasUV([ATLAS.digits[0] + d * 40, ATLAS.digits[1], 40, ATLAS.digits[3]], uv.getX(k), uv.getY(k)); uv.setXY(k, a, b); }
    g.translate((i - 1.5) * dw * 1.05, y, 0.0024).applyQuaternion(q).translate(p.x, p.y, p.z);
    parts.push(g);
  }
  return mergeSimple(parts);
}

// ---------------------------------------------------------------------------
// Embroidered shoulder patch (left sleeve, outer side) + hood stencil
// ---------------------------------------------------------------------------
export function buildPatch(B) {
  const side = 'L', ax = -DIM.shX, dy = 0.06, R = 0.0735, rad = 0.03;
  const g = decalGrid(12, 12, (u, v, p) => {
    const a = PI + (u - 0.5) * (2 * rad / R), yy = Y.chest - dy + (v - 0.5) * 2 * rad;
    p.set(ax + Math.cos(a) * R, yy, Math.sin(a) * R * 0.96);
  }, 'patch', { flipU: true });
  ensureOutward(g, V(ax, Y.chest - dy, 0));
  // raised embroidery thickness: slight dome
  displace(g, (x, y, z) => 0.0012);
  B.skinned('decal', g, armW(side));
}
export function buildHoodStencil(B) {
  // on the back of the hood, a little above the pole
  const hb = Y.head;
  const base = V(0, 0.12, 0.99).normalize();
  const side = V(1, 0, 0), up = V().crossVectors(base, side).normalize();
  const g = decalGrid(20, 5, (u, v, p, n) => {
    const d = base.clone().addScaledVector(side, (u - 0.5) * 1.05).addScaledVector(up, (v - 0.5) * 0.3).normalize();
    hoodPoint(d, 0.92, PI / 2, p); p.y += hb;
    const c = V(0, hb + SACK.cy, 0); p.addScaledVector(p.clone().sub(c).normalize(), 0.004);
  }, 'hoodtxt');
  ensureOutward(g, V(0, hb + SACK.cy, 0));
  B.skinned('decal', g, hoodW);
}

// ---------------------------------------------------------------------------
// Dynamic ribbed hose (rig-root space, rebuilt every frame)
// ---------------------------------------------------------------------------
const _h1 = V(), _h2 = V(), _h3 = V(), _h4 = V();
export class Hose {
  constructor(material, segs = 64, rad = 9, r = 0.0135) {
    this.segs = segs; this.rad = rad; this.r = r;
    const n = (segs + 1) * (rad + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2), col = new Float32Array(n * 3), idx = [];
    for (let i = 0; i <= segs; i++) for (let j = 0; j <= rad; j++) {
      const k = i * (rad + 1) + j; uv[k * 2] = j / rad * 0.08; uv[k * 2 + 1] = i / segs * 0.4;
      const c = i % 2 ? 0.09 : 0.075; col[k * 3] = c; col[k * 3 + 1] = c; col[k * 3 + 2] = c * 1.05;
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.name = 'hose';
    this.pts = Array.from({ length: segs + 1 }, () => V());
    this.mid = V(); this.midV = V(); this.has = false;
    this.N = V(); this.T = V(); this.Bv = V();
  }
  update(dt, p0, t0, p3, t3) {
    const L = p0.distanceTo(p3);
    const P1 = _h1.copy(p0).addScaledVector(t0, L * 0.42);
    const P2 = _h2.copy(p3).addScaledVector(t3, L * 0.42);
    const target = _h3.copy(P1).add(P2).multiplyScalar(0.5); target.y -= 0.05;
    if (!this.has) { this.mid.copy(target); this.midV.set(0, 0, 0); this.has = true; }
    const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
    for (let i = 0; i < n; i++) {
      _h4.subVectors(target, this.mid).multiplyScalar(140).addScaledVector(this.midV, -9);
      this.midV.addScaledVector(_h4, h); this.mid.addScaledVector(this.midV, h);
    }
    if (this.mid.distanceToSquared(target) > 0.04) { this.mid.copy(target); this.midV.set(0, 0, 0); }
    const off = _h4.subVectors(this.mid, target);
    for (let i = 0; i <= this.segs; i++) {
      const t = i / this.segs, it = 1 - t;
      this.pts[i].set(0, 0, 0).addScaledVector(p0, it * it * it).addScaledVector(P1, 3 * it * it * t).addScaledVector(P2, 3 * it * t * t).addScaledVector(p3, t * t * t).addScaledVector(off, Math.sin(t * PI) * 1.2);
    }
    const pos = this.mesh.geometry.attributes.position, nor = this.mesh.geometry.attributes.normal;
    const T = this.T, N = this.N.set(0, 0, 1), Bv = this.Bv;
    for (let i = 0; i <= this.segs; i++) {
      T.subVectors(this.pts[Math.min(this.segs, i + 1)], this.pts[Math.max(0, i - 1)]).normalize();
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-6) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize(); Bv.crossVectors(T, N);
      const p = this.pts[i];
      const end = i < 3 || i > this.segs - 3;
      const rr = this.r * (end ? 1.25 : (i % 2 ? 1.1 : 0.9));
      for (let j = 0; j <= this.rad; j++) {
        const a = (j / this.rad) * TAU, c = Math.cos(a), s = Math.sin(a);
        const nx = N.x * c + Bv.x * s, ny = N.y * c + Bv.y * s, nz = N.z * c + Bv.z * s, k = i * (this.rad + 1) + j;
        pos.setXYZ(k, p.x + nx * rr, p.y + ny * rr, p.z + nz * rr); nor.setXYZ(k, nx, ny, nz);
      }
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }
}
export { facePt };
