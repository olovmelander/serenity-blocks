/**
 * Rainbark — curls and flakes (§4.7, as built): the strips of bark the grove sheds.
 *
 * One instanced draw of strips (CURL_SEGMENTS along × 1 across) holds two pools:
 *   ambient  [0, A)       the grove's own shedding: each slot respawns once a cycle (its period
 *                         hashed round A / CURL.rate seconds), on a trunk the eye can see, at a
 *                         height its depth shows, away from the card's screen band; a cycle is
 *                         skipped by hash while a session is live (CURL.live) or under Mistfall.
 *                         Closed form in (slot, cycle): a seek lands on the same curls.
 *   event    [A, A + E)   what the board drives, a ring: a lock's strip (kind 1: it rolls into a
 *                         scroll riding the peel's front down the band, detaches, pops outward and
 *                         tumbles down into the mist), a knock's flakes (kind 2: chips shaken loose
 *                         above the impact).
 * Each slot is one record of CURL.stride floats in ONE interleaved instance buffer, written by the
 * CPU only when a slot is (re)spawned; the vertex stage does the rest in closed form: the roll
 * (a strip of curvature κ: (sin φ/κ, (1 − cos φ)/κ) along its length), the tumble round a
 * precessing axis, the eased fall to terminal speed, the outward pop, the drift back and the
 * flutter. The outer face is old bark (its own age's colour, streaked), the inner face Curl
 * Underside; a curl crossing a fleck glows through (backlit) where the sun stands behind it.
 * Anything that would cross the card fades out (u.cardRect, widened). Premultiplied over.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CURL,
    LEAF,
    TAU,
    hexToLinear,
    mulberry32,
    rbAir,
    rbFleck,
    rbFxMaterial,
    rbHash21,
    rbHgMix,
    rbLuma,
    rbPart,
    rbQuatRotate,
} from './rainbark-tsl.js';

/**
 * A lock's dried strip (CURL.lock): its spiral's total turn (radians), the decay of its radius a
 * radian (to `inner` at the end) and its outer radius per metre of strip width (the spiral's arc
 * length is the width: ρ0 = W·β / (1 − e^(−βΨ))).
 */
const LOCK = CURL.lock;
const SPIRAL_TURN = LOCK.turns * 2 * Math.PI;
const SPIRAL_BETA = Math.log(1 / LOCK.inner) / SPIRAL_TURN;
const SPIRAL_ARC = SPIRAL_BETA / (1 - LOCK.inner);
/**
 * Segments along a strip, and across it (a quill's roll needs a curve across, not two edges; a
 * lock's dried curl, most of a turn, needs ten, or its triangles fold into a sawtooth).
 */
/** The light inside a roll: the underside's share of the sky and the mist's glow, no sun. */
const CURL_INSIDE = 0.4;
/** A ring's sheet's curled tip: this much brighter (its lit lip). */
const CURL_LIP = 0.35;
const CURL_SEGMENTS = 14;
const CURL_ACROSS = 10;
/** After the mist (60, 61), before the shafts (72). */
const CURL_ORDER = 65;
/** Floats per record: six vec4 (spawn+t0, out+life+detach, size, look, motion, more). */
const STRIDE = 24;
/** The inner face of shed bark (#DCE8B8); a leaf's two faces (Crown Green, its backlit edge). */
const UNDERSIDE = hexToLinear('#DCE8B8');
const LEAF_TOP = hexToLinear('#2E5A35');
const LEAF_UNDER = hexToLinear('#6E9A4A');
/**
 * How far (screen fraction) outside the card a curl starts to fade, and is gone; and how near the
 * eye (metres, `eye`: gone at [0], whole from [1]).
 */
const KEEP_OUT = Object.freeze({ near: 0.075, gone: 0.03, eye: Object.freeze([2.5, 5.0]) });

/** A strip: x across (−0.5 … 0.5), y along (0 at its attached end … 1 at its free end). */
function stripGeometry(slots, data) {
    const corners = [];
    for (let j = 0; j <= CURL_SEGMENTS; j++) {
        for (let i = 0; i <= CURL_ACROSS; i++) corners.push(i / CURL_ACROSS - 0.5, j / CURL_SEGMENTS, 0);
    }
    const index = [];
    const row = CURL_ACROSS + 1;
    for (let j = 0; j < CURL_SEGMENTS; j++) {
        for (let i = 0; i < CURL_ACROSS; i++) {
            const a = j * row + i;
            index.push(a, a + 1, a + row, a + row, a + 1, a + row + 1);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex(index);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    ['aCurlA', 'aCurlB', 'aCurlC', 'aCurlD', 'aCurlE', 'aCurlF'].forEach((name, i) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4));
    });
    geometry.instanceCount = slots;
    return { geometry, buffer };
}

/** The draw's material: the strip built in the vertex stage, lit and seen through the air. */
function curlMaterial(u) {
    const material = rbFxMaterial('RainbarkCurls');
    // (A rolled strip hides its own inner turns: the curls write depth, unlike the other fx, so a
    // spiral's far layers never draw over its near one; a faded pixel writes none.)
    material.depthWrite = true;
    material.alphaTest = 0.02;
    const A = attribute('aCurlA', 'vec4');
    const B = attribute('aCurlB', 'vec4');
    const C = attribute('aCurlC', 'vec4');
    const D = attribute('aCurlD', 'vec4');
    const E = attribute('aCurlE', 'vec4');
    const F = attribute('aCurlF', 'vec4');
    const vWorld = varying(vec3(0.0), 'rbCurlWorld');
    const vNormal = varying(vec3(0.0, 0.0, 1.0), 'rbCurlNormal');
    const vStrip = varying(vec2(0.0), 'rbCurlStrip');
    const vLook = varying(vec4(0.0), 'rbCurlLook');

    material.positionNode = Fn(() => {
        const age = u.time.sub(A.w).toVar();
        const life = B.z;
        const alive = step(0.0, age).mul(step(age, life)).toVar();
        const detach = B.w;
        // Riding the peel's front (a lock's strip), then free.
        const riding = step(age, detach).mul(step(1e-3, detach)).toVar();
        const ride = clamp(age.div(max(detach, 1e-3)), 0.0, 1.0);
        const rideEase = float(1.0).sub(float(1.0).sub(ride).mul(float(1.0).sub(ride)));
        const a = max(age.sub(detach), 0.0).toVar();
        const seed = floor(D.y.add(0.5));
        const h1 = rbHash21(vec2(seed, 3.1)).toVar();
        const h2 = rbHash21(vec2(seed, 7.7)).toVar();
        // ── Its shape. A lock's strip is a page peeling off: rolled along its length, loosely (seen
        // beside the silhouette a tight scroll would point at the eye), curling tighter as it dries
        // in the fall. Everything else is a quill, as shed bark curls: rolled across its width
        // (radius C.z, F.x of the way round), twisting along its length (so its faces turn in and
        // out of the light as it falls) and bowed a little. ──
        const s = positionGeometry.y;
        const w = positionGeometry.x;
        // (A page: a lock's strip, kind 1. A ring's sheet pieces, kind 5, are curved plates: quills
        // that peel down their band, rolled only part of the way round.)
        // (A T-spin's strip, kind 6, takes the lock's shape too: an open lip, then a spiral quill.)
        const isLock = step(0.5, D.z).mul(step(D.z, 1.5)).add(step(5.5, D.z).mul(step(D.z, 6.5))).toVar();
        const length = C.x.mul(mix(float(1.0), rideEase, riding)).toVar();
        const width = C.y.mul(sin(s.mul(Math.PI)).mul(0.25).add(0.75)).toVar();
        // (The lip: turned CURL.lock.lip radians at its middle, open, never a closed scroll.)
        // (A ring's sheet rolls further than a lock's lip: a curled strip, lit on its convex edge.)
        const lip = mix(float(LOCK.lip), float(CURL.sheet.lip), step(4.5, D.z).mul(step(D.z, 5.5)));
        const phi = s.mul(s.mul(0.8).add(0.6)).mul(lip).toVar();
        const kappa = phi.div(max(s.mul(length), 0.02)).max(1e-3).toVar();
        const page = vec3(w.mul(width), sin(phi).div(kappa), float(1.0).sub(cos(phi)).div(kappa));
        const pageN = vec3(0.0, sin(phi).negate(), cos(phi));
        const kq = max(F.x.div(max(C.z, 0.01)), 0.05).toVar();
        const psi = w.mul(width).mul(kq).toVar();
        const along = s.mul(length).toVar();
        // (A T-spin's corkscrew, kind 6, twists harder; a strip's segments never turn more than a
        // quarter turn each, or its triangles fold into saw teeth.)
        const corkscrew = step(5.5, D.z).mul(step(D.z, 6.5));
        const tw = along.mul(h2.mul(2.0).add(1.5).add(corkscrew.mul(2.5))).add(h1.mul(TAU)).toVar();
        // (Rolled round a centre behind its old bark, as a strip curls on the tree: the old bark
        // outside, the pale underside within.)
        const cx = sin(psi).div(kq);
        const cz = float(1.0).sub(cos(psi)).div(kq).negate();
        const ct = cos(tw);
        const st = sin(tw);
        const quill = vec3(cx.mul(ct).sub(cz.mul(st)), along, cx.mul(st).add(cz.mul(ct)).add(along.mul(along).mul(0.18)));
        const quillN = vec3(sin(psi).mul(ct).sub(cos(psi).mul(st)), 0.0, sin(psi).mul(st).add(cos(psi).mul(ct)));
        // A lock's strip, once free, dries into a quill of its full length: rolled across its width
        // in an open curl (CURL.lock.turns of a turn, tightening to .inner): never closing on itself,
        // whose overlapping turns would show through one another.
        const dry = isLock.mul(float(1.0).sub(riding)).mul(smoothstep(0.0, LOCK.settle, a)).toVar();
        const psiS = w.add(0.5).mul(SPIRAL_TURN).toVar();
        const rho0 = width.mul(SPIRAL_ARC);
        const rho = rho0.mul(exp(psiS.mul(-SPIRAL_BETA))).toVar();
        // (Turned as a whole by its seed, never twisted along its length: a twisted quad is bent,
        // and at grazing its two triangles would show different faces, a tick of cream a segment.)
        const spun = h1.mul(0.6);
        const sx = rho.mul(sin(psiS.add(spun)));
        const sz = rho.mul(cos(psiS.add(spun)));
        const spiral = vec3(sx, along, sz.sub(rho0));
        const spiralN = vec3(sin(psiS.add(spun)), 0.0, cos(psiS.add(spun)));
        // (A ring's sheet, kind 5, peels down its band as a lip too, and once free stays mostly a
        // lip, only CURL.sheet.plate of the way eased into a curved plate (a short, wide plate rolled
        // across its width reads as a pill); each slanted by its own hash, CURL.sheet.slant.)
        const isSheet = step(4.5, D.z).mul(step(D.z, 5.5)).toVar();
        const free = float(1.0).sub(riding).mul(smoothstep(0.0, LOCK.settle, a));
        const pageK = isLock.add(isSheet.mul(float(1.0).sub(free.mul(CURL.sheet.plate)))).toVar();
        // (Most of its slant while it peels down its band, the rest as it pops clear.)
        const slant = isSheet.mul(h2.sub(0.5).mul(2 * CURL.sheet.slant)).mul(free.mul(0.4).add(0.6));
        const cs = cos(slant).toVar();
        const sn = sin(slant).toVar();
        const tilt = (v) => vec3(v.x.mul(cs).sub(v.y.mul(sn)), v.x.mul(sn).add(v.y.mul(cs)), v.z);
        const local = tilt(mix(mix(quill, page, pageK), spiral, dry)).toVar();
        const localN = normalize(tilt(mix(mix(quillN, pageN, pageK), spiralN, dry)));
        // Its own frame on the trunk: across (T), up, out (N).
        const out = normalize(vec3(B.x, 0.0, B.y).add(vec3(1e-6, 0.0, 0.0))).toVar();
        const T = vec3(out.z.negate(), 0.0, out.x);
        const Y = vec3(0.0, 1.0, 0.0);
        const toWorld = (v) => T.mul(v.x).add(Y.mul(v.y)).add(out.mul(v.z));
        // ── The tumble, round its middle (none while riding; spun up gently) ──
        const spinUp = a.sub(float(0.15).mul(float(1.0).sub(exp(a.div(-0.15)))));
        const angle = spinUp.mul(D.w).mul(TAU).add(F.y.mul(h2).mul(TAU)).mul(float(1.0).sub(riding));
        const prec = a.mul(0.7).add(h1.mul(TAU));
        const axis = normalize(vec3(sin(prec), float(0.35), cos(prec)));
        const q = vec4(axis.mul(sin(angle.mul(0.5))), cos(angle.mul(0.5))).toVar();
        const pagePivot = vec3(0.0, length.mul(0.45), length.mul(0.2));
        const spiralPivot = vec3(0.0, length.mul(0.5), C.y.mul(SPIRAL_ARC).negate());
        const pivot = mix(mix(vec3(0.0, length.mul(0.5), 0.0), pagePivot, pageK), spiralPivot, dry);
        const shaped = rbQuatRotate(q, toWorld(local.sub(pivot))).add(toWorld(pivot)).toVar();
        const normal = rbQuatRotate(q, toWorld(localN));
        // ── Where it is: the front's descent while riding, then the eased fall, the pop, the drift
        // back and the flutter (every exp bounded) ──
        const spawn = A.xyz;
        const descent = C.w.mul(mix(float(1.0), rideEase, riding));
        const fallTau = max(E.y, 0.05);
        const outTau = max(E.w, 0.05);
        const fall = E.x.mul(a.sub(fallTau.mul(float(1.0).sub(exp(a.div(fallTau).negate().max(-30.0))))));
        const pop = E.z.mul(outTau).mul(float(1.0).sub(exp(a.div(outTau).negate().max(-30.0))));
        const flutter = sin(a.mul(TAU * 0.3).add(h1.mul(TAU))).mul(F.w).mul(smoothstep(0.0, 0.6, a));
        const anchor = spawn.sub(Y.mul(descent)).add(out.mul(pop)).sub(Y.mul(fall))
            .add(vec3(0.0, 0.0, F.z.negate().mul(a)))
            .add(T.mul(flutter))
            .toVar();
        // ── How much of it shows: born (ambient curls fade in), dying, in the card's band ──
        const born = mix(smoothstep(0.0, 0.4, age), float(1.0), step(0.5, D.z));
        const dying = float(1.0).sub(smoothstep(life.sub(1.6), life, age));
        // (Judged at each vertex: a long quill fades only where it nears the card, never whole,
        // and never reaches into it.)
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(anchor.add(shaped), 1.0)).toVar();
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const dx = max(r.x.sub(scr.x), scr.x.sub(r.z));
        const dy = max(r.y.sub(scr.y), scr.y.sub(r.w));
        const away = max(dx, dy);
        const clear = smoothstep(KEEP_OUT.gone, KEEP_OUT.near, away).max(step(clip.w, 0.0));
        // (Never a great pale blade across the frame: a curl drifting past the eye fades out.)
        const nearEye = smoothstep(KEEP_OUT.eye[0], KEEP_OUT.eye[1], clip.w);
        const shown = alive.mul(born).mul(dying).mul(clear).mul(nearEye);
        vLook.assign(vec4(D.x, seed, D.z, shown));
        vStrip.assign(vec2(s, w));
        const P = anchor.add(shaped.mul(alive)).toVar();
        vWorld.assign(P);
        vNormal.assign(normal);
        return P;
    })();

    material.colorNode = Fn(() => {
        const P = vWorld;
        const n = normalize(vNormal).toVar();
        const V = normalize(cameraPosition.sub(P)).toVar();
        // The face we see: its outer (old bark) side, or its inner (fresh underside) one, by the
        // interpolated normal, softly over grazing (by a triangle's own winding the silhouette of a
        // curled strip would zigzag along each quad's diagonal).
        const outer = smoothstep(-0.08, 0.08, dot(n, V)).toVar();
        const nf = n.mul(outer.mul(2.0).sub(1.0)).toVar();
        const s = clamp(vStrip.x, 0.0, 1.0);
        const seed = vLook.y;
        // Old bark streaked along the strip; the underside pale lime-cream, faintly fibrous.
        const streak = u.fbm(vec2(vStrip.y.mul(0.35).add(seed.mul(0.13)), s.mul(1.4).add(seed.mul(0.71)))).toVar();
        const bark = u.ramp(clamp(vLook.x.add(streak.r.sub(0.5).mul(0.08)), 0.0, 1.0));
        const leaf = step(2.5, vLook.z).mul(step(vLook.z, 3.5));
        // (A ring's sheet, kind 5, and the curtains' and the Moult's quills, kind 4, wear the bands'
        // settled chroma: never a magenta horn in flight.)
        const isSheet = step(4.5, vLook.z).mul(step(vLook.z, 5.5)).toVar();
        const settled = step(3.5, vLook.z).mul(step(vLook.z, 5.5));
        const outerCol = mix(
            mix(vec3(rbLuma(bark)), bark, mix(float(0.82), float(CURL.sheet.chroma), settled))
                .mul(streak.g.sub(0.5).mul(0.3).add(0.82)),
            vec3(...LEAF_TOP).mul(streak.g.sub(0.5).mul(0.3).add(0.9)),
            leaf,
        );
        const innerCol = mix(
            vec3(...UNDERSIDE).mul(streak.b.sub(0.5).mul(0.16).add(0.5)),
            vec3(...LEAF_UNDER).mul(streak.b.sub(0.5).mul(0.2).add(0.8)),
            leaf,
        );
        const col = mix(innerCol, outerCol, outer).toVar();
        // Light: the canopy's flecks (the sun), the sky above, the mist's warm glow below, and the
        // sun through the thin bark where it stands behind the curl (backlit: ember, ruby).
        const L = u.sunDir;
        const fl = rbFleck(u, P, { lod: 'fixed' }).mul(u.fleckLight).toVar();
        // (Between the flecks the canopy's diffuse glow still reaches it, as it does the bark.)
        const lit = max(mix(u.fleckMean.mul(u.fleckLight), fl, 0.85), u.fleckMean.mul(u.fleckLight).mul(1.6)).toVar();
        const direct = u.sunCol.mul(lit).mul(max(dot(nf, L), 0.0));
        const sunSide = dot(nf.xz, normalize(L.xz)).mul(0.5).add(0.5);
        const sky = u.col.sky.mul(nf.y.mul(0.25).add(0.4)).add(u.col.hazeSun.mul(smoothstep(0.2, 1.0, sunSide).mul(0.45)));
        const glow = u.col.underglow.mul(exp(max(P.y.sub(u.tide), 0.0).div(-30.0)).mul(0.35))
            .mul(max(nf.y.negate(), 0.0).mul(0.6).add(0.4));
        const through = rbHgMix(dot(L, V.negate()), float(0.6));
        const thin = mix(innerCol, outerCol.mul(1.6), 0.55);
        const back = u.sunCol.mul(lit).mul(through).mul(float(1.0).sub(abs(dot(n, L)))).mul(0.55);
        // Fibres along the strip (fine streaks across its width, long along it), on both faces.
        const fibres = u.fbm(vec2(vStrip.y.mul(2.2).add(seed.mul(0.31)), s.mul(0.25).add(seed.mul(0.17)))).a;
        col.mulAssign(fibres.sub(0.5).mul(0.45).mul(outer).add(1.0));
        // (Inside a roll the underside is in its own shade: plain, no sun, darker: CURL_INSIDE. Its
        // inner turns never read as a ladder of teeth.)
        // (A ring's sheet is an open lip, not a roll: its cream underside stands in the light.)
        const inside = float(1.0).sub(outer).mul(float(1.0).sub(isSheet));
        const light = mix(direct.add(sky).add(glow), sky.add(glow).mul(CURL_INSIDE), inside);
        const shaded = col.mul(light).add(thin.mul(back).mul(outer)).toVar();
        // (Its curled tip catches the light: a lit lip along the curl's edge.)
        shaded.mulAssign(smoothstep(0.86, 0.97, s).mul(isSheet).mul(CURL_LIP).add(1.0));
        const seen = rbAir(u, shaded, P, null, { billows: 0 });
        // A frayed edge across the strip (no hard ribbon edge at a few pixels).
        // Torn, never cut: frayed along its sides, its two ends ragged across the grain.
        // (A lock's or a T-spin's strip, rolled into a curl, keeps its long edges whole: a faded lip
        // writes depth like the rest, hiding the curl's far wall behind half-seen pixels, a tooth a
        // segment.)
        const rolled = step(0.5, vLook.z).mul(step(vLook.z, 1.5)).add(step(5.5, vLook.z).mul(step(vLook.z, 6.5)));
        const sides = float(1.0).sub(smoothstep(0.38, 0.5, abs(vStrip.y).add(streak.a.sub(0.5).mul(0.22))));
        const fray = mix(sides, float(1.0), rolled)
            .mul(smoothstep(0.0, 0.06, s.add(fibres.sub(0.5).mul(0.12))))
            .mul(float(1.0).sub(smoothstep(0.95, 1.0, s.add(fibres.sub(0.5).mul(0.04)))));
        const alpha = clamp(vLook.w.mul(fray), 0.0, 1.0);
        return vec4(seen.mul(alpha), alpha);
    })();
    return material;
}

/**
 * The curls part.
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (curlsAmbient, curlsEvent; its name for CURL.rate)
 * @param {string} quality
 */
export function createCurls(u, tier, quality = 'High') {
    const ambient = Math.max(0, Math.round(tier.curlsAmbient || 0));
    const events = Math.max(1, Math.round(tier.curlsEvent || 1));
    const slots = ambient + events;
    const data = new Float32Array(slots * STRIDE);
    const { geometry, buffer } = stripGeometry(slots, data);
    const material = curlMaterial(u);
    const part = rbPart('RainbarkCurls', geometry, material, CURL_ORDER);
    const rate = CURL.rate[quality] || CURL.rate.High;
    /** Each ambient slot's period, phase and the cycle it last spawned for. */
    const period = new Float32Array(ambient);
    const phase = new Float32Array(ambient);
    const cycle = new Float64Array(ambient).fill(NaN);
    const meanPeriod = Math.max(8, ambient / rate);
    for (let i = 0; i < ambient; i++) {
        const rng = mulberry32(0x5eed + i * 7919);
        period[i] = meanPeriod * (0.75 + 0.5 * rng());
        phase[i] = period[i] * rng();
    }
    let cursor = 0;
    let dirty = true;

    const write = (slot, rec) => {
        data.set(rec, slot * STRIDE);
        dirty = true;
    };
    /**
     * The event slot a new curl at time t takes: the first spent (or empty) one from the cursor on,
     * else the one whose curl ends soonest, so a moult's sheets or a Set's curtain never cut a strip
     * still falling while one nearly gone could make room. Advances the cursor (its count salts
     * every spawn's hashes).
     */
    const take = (t) => {
        let slot = -1;
        let soonest = Infinity;
        for (let k = 0; k < events; k++) {
            const s = ambient + ((cursor + k) % events);
            const o = s * STRIDE;
            const end = data[o + 6] > 0 ? data[o + 3] + data[o + 6] : -Infinity;
            if (end <= t) {
                slot = s;
                break;
            }
            if (end < soonest) {
                soonest = end;
                slot = s;
            }
        }
        cursor += 1;
        return slot;
    };
    const rec = new Float32Array(STRIDE);
    const kill = (slot) => {
        data.fill(0, slot * STRIDE, slot * STRIDE + STRIDE);
        dirty = true;
    };

    /**
     * Respawn the ambient slots whose cycle has turned (all of them after a reset): `world`
     * supplies the emitters (visible trunks), the live share and a projection for the keep-out.
     */
    part.updateAmbient = (t, scene) => {
        for (let i = 0; i < ambient; i++) {
            const n = Math.floor((t + phase[i]) / period[i]);
            if (n === cycle[i]) continue;
            cycle[i] = n;
            const t0 = n * period[i] - phase[i];
            const rng = mulberry32(((i + 1) * 2654435761 + n * 40503) >>> 0);
            if (rng() > scene.share || !scene.emitters.length) {
                kill(i);
                continue;
            }
            const A0 = CURL.ambient;
            let placed = false;
            for (let attempt = 0; attempt < 4 && !placed; attempt++) {
                const pick = scene.pick(rng());
                if (!pick) break;
                const theta = pick.facing + (rng() - 0.5) * 2.4;
                const depth = Math.max(4, pick.depth);
                const y = Math.min(scene.canopyY - 8, scene.eyeY + depth * (A0.rise[0] + (A0.rise[1] - A0.rise[0]) * rng()));
                const axis = scene.axisAt(pick, y);
                const ox = Math.cos(theta);
                const oz = Math.sin(theta);
                const x = axis[0] + ox * axis[2];
                const z = axis[1] + oz * axis[2];
                const screen = scene.project(x, y, z);
                if (!(screen[0] > -0.05 && screen[0] < 1.05) || scene.inCardBand(screen[0])) continue;
                const fallLife = (y - (scene.tide - 8)) / A0.fall + 2;
                const life = Math.max(0, Math.min(A0.life[0] + (A0.life[1] - A0.life[0]) * rng(), fallLife, period[i] * 0.95));
                if (life < 3) continue;
                const len = A0.length[0] + (A0.length[1] - A0.length[0]) * rng();
                rec.set([
                    x + ox * 0.03, y, z + oz * 0.03, t0,
                    ox, oz, life, 0,
                    len, A0.width[0] + (A0.width[1] - A0.width[0]) * rng(), 0.03 + 0.05 * rng(), 0,
                    0.8 + 0.18 * rng(), (i * 13 + n * 7) % 997, 0, A0.spin[0] + (A0.spin[1] - A0.spin[0]) * rng(),
                    A0.fall, A0.fallTau, A0.out * (0.4 + 0.6 * rng()), A0.outTau,
                    0.45 + 0.5 * rng(), 1, A0.back, A0.flutter * (0.5 + rng()),
                ]);
                write(i, rec);
                placed = true;
            }
            if (!placed) kill(i);
        }
    };

    /**
     * A lock's strip (kind 1) or a ring's sheet piece (kind 5, `p.kind`): rides the front down
     * its band, then detaches, pops out and tumbles away.
     */
    part.spawnLock = (t, p) => {
        const slot = take(t);
        const kind = p.kind || 1;
        const K = kind === 1 ? CURL.lock : CURL.sheet;
        const ox = Math.cos(p.theta);
        const oz = Math.sin(p.theta);
        const drop = Math.max(0.2, p.yTop - p.yBot);
        const ride = p.unzip + K.detach;
        rec.set([
            p.axisX + ox * (p.radius + 0.02), p.yTop, p.axisZ + oz * (p.radius + 0.02), t + p.delay,
            ox, oz, K.life, ride,
            drop, p.width, 0.32 + 0.1 * ((cursor * 0.618) % 1), drop,
            p.outerAge, cursor % 997, kind, p.hard ? K.spinHard : K.spin,
            K.fall, K.fallTau, K.out * (p.hard ? 1.5 : 1), K.outTau,
            kind === 1 ? 0.85 : K.roll, 0, K.back, K.flutter,
        ]);
        write(slot, rec);
    };

    /** A knock's flakes: `count` chips shaken loose above the impact (kind 2). */
    part.spawnFlakes = (t, p, count) => {
        const K = CURL.flake;
        for (let i = 0; i < count; i++) {
            const slot = take(t);
            const rng = mulberry32((cursor * 2246822519) >>> 0);
            const theta = p.theta + (rng() - 0.5) * p.spread;
            const ox = Math.cos(theta);
            const oz = Math.sin(theta);
            const y = p.y0 + K.above[0] + (K.above[1] - K.above[0]) * rng();
            const axis = p.axisAt(y);
            rec.set([
                axis[0] + ox * (axis[2] + 0.02), y, axis[1] + oz * (axis[2] + 0.02), t + 0.05 * rng(),
                ox, oz, K.life * (0.7 + 0.6 * rng()), 0,
                K.length[0] + (K.length[1] - K.length[0]) * rng(), K.width[0] + (K.width[1] - K.width[0]) * rng(), 0.04, 0,
                0.86 + 0.12 * rng(), cursor % 997, 2, K.spin[0] + (K.spin[1] - K.spin[0]) * rng(),
                K.fall, K.fallTau, K.out * (0.4 + 0.8 * rng()), K.outTau,
                0.3 + 0.4 * rng(), 1, K.back, K.flutter,
            ]);
            write(slot, rec);
        }
    };

    /**
     * Leaf bits (kind 3) shaken from the crowns over a point: `count` leaves spread round (x, z),
     * from height `y` (the top of the frame at that depth) down.
     */
    part.spawnLeaves = (t, x, y, z, count) => {
        const K = LEAF;
        for (let i = 0; i < count; i++) {
            const slot = take(t);
            const rng = mulberry32((cursor * 3266489917) >>> 0);
            const a = rng() * TAU;
            rec.set([
                x + Math.cos(a) * K.spread * rng(), y + 1.5 * rng(), z + Math.sin(a) * K.spread * rng(), t + 0.6 * rng(),
                Math.cos(a), Math.sin(a), K.life * (0.8 + 0.4 * rng()), 0,
                K.length[0] + (K.length[1] - K.length[0]) * rng(), K.width[0] + (K.width[1] - K.width[0]) * rng(), 0.6, 0,
                0, cursor % 997, 3, K.spin[0] + (K.spin[1] - K.spin[0]) * rng(),
                K.fall * (0.7 + 0.6 * rng()), K.fallTau, K.out, K.outTau,
                0.15 + 0.2 * rng(), 1, K.back, K.flutter,
            ]);
            write(slot, rec);
        }
    };

    /**
     * The Set's curtain: `count` curls (kind 0 looks, as event slots) off the near trunks' outer
     * lanes, spawned top to bottom over `over` seconds. `pick(i)` gives each one's spawn as
     * [x, y, z, out x, out z] (the world knows the trunks).
     */
    part.spawnCurtain = (t, count, over, pick) => {
        const A0 = CURL.ambient;
        for (let i = 0; i < count; i++) {
            const at = pick(i, count);
            if (!at) continue;
            const slot = take(t);
            const rng = mulberry32((cursor * 2654435761) >>> 0);
            rec.set([
                at[0], at[1], at[2], t + ((over * i) / Math.max(1, count - 1)) * (0.85 + 0.3 * rng()),
                at[3], at[4], 9 + 4 * rng(), 0,
                A0.length[1] * (1.1 + 0.9 * rng()), A0.width[1] * (1.0 + 0.6 * rng()), 0.035 + 0.035 * rng(), 0,
                0.55 + 0.37 * rng(), cursor % 997, 4, A0.spin[0] + (A0.spin[1] - A0.spin[0]) * rng(),
                A0.fall * 1.15, A0.fallTau, 0.9 + 0.8 * rng(), 0.8,
                0.5 + 0.4 * rng(), 1, A0.back, A0.flutter,
            ]);
            write(slot, rec);
        }
    };

    /**
     * The Great Moult's sheets: `count` quills (kind 4) off the grove along the sweeping front;
     * `pick(i, rng)` gives [x, y, z, out x, out z, t0, outer age] or null.
     */
    part.spawnMoult = (t, count, pick) => {
        const A0 = CURL.ambient;
        for (let i = 0; i < count; i++) {
            const rng = mulberry32(((cursor + 1) * 2246822519 + i * 3266489917) >>> 0);
            const at = pick(i, rng);
            if (!at) continue;
            const slot = take(t);
            rec.set([
                at[0], at[1], at[2], at[5],
                at[3], at[4], 10 + 5 * rng(), 0,
                A0.length[1] * (0.6 + 0.7 * rng()), A0.width[1] * (0.7 + 0.6 * rng()), 0.03 + 0.04 * rng(), 0,
                at[6], cursor % 997, 4, A0.spin[0] + (A0.spin[1] - A0.spin[0]) * rng(),
                A0.fall * 1.3, A0.fallTau, 1.0 + rng(), 0.7,
                0.45 + 0.45 * rng(), 1, A0.back, A0.flutter,
            ]);
            write(slot, rec);
        }
    };

    /** Drop every event curl and make the ambient pool respawn (a seek, a new session). */
    part.reset = () => {
        data.fill(0);
        cycle.fill(NaN);
        cursor = 0;
        dirty = true;
    };

    /** Upload what changed this frame. */
    part.commit = () => {
        if (!dirty) return;
        dirty = false;
        buffer.needsUpdate = true;
    };

    part.ambient = ambient;
    part.events = events;
    part.dispose = () => {
        geometry.dispose();
        material.dispose();
    };
    return part;
}
