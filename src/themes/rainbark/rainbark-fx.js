/**
 * Rainbark — the effects layer (§4.8): the shafts and the drops.
 *
 *   shafts  slabs of sunlit haze along the sun's ray, slanting down-left through the air on the
 *           right (geometry, never a screen-space god ray): the three ambient shafts (Medium and
 *           up, AMBIENT_SHAFTS) and the seven combo shafts, one under each canopy gap a chain
 *           opens (the event table's gap rows; dormant, collapsed to nothing, while their gap is
 *           shut). Each is a strip along the ray turned to face the camera round it, lit per vertex
 *           (the sun forward-scattered toward the eye, the haze's density along it, the air in
 *           front of it) over a span with soft ends, and per fragment a soft profile across it
 *           streaked by slow motes drifting down it. Additive (vec4(rgb, 0)) and depth-tested, so
 *           the trunks stand in front of it; what shows through the card is calm-clipped by the post.
 *
 *   drops   the Sunshower's rain (§6.8): streaks RAIN.length metres long falling RAIN.speed m/s, each
 *           slot a column it falls down again and again (closed form in the clock: a new place every
 *           pass), in a volume of air in front of the eye. The first u.rain of the pool falls; a drop
 *           glints only where the canopy's light reaches it (the flecks: rbFleck at its place), at
 *           RAIN.shade of that against the shade. A drop that would cross the card collapses.
 *           Additive (vec4(rgb, 0)).
 *
 *   motes   seeds and pollen adrift in the air in front of the eye (MOTES), each slot one mote for
 *           good, world-fixed and wrapped round the eye, glinting only where the canopy's light
 *           reaches it (rbFleck at its place: the sun's patches of air that land as flecks on the
 *           bark), in brief flashes as it tumbles, faint in the shade. Additive (vec4(rgb, 0)).
 *
 * Every slot is drawn on every frame (a shut gap's shaft has no width), so the first frame compiles
 * the pipeline and the scene never changes after it is built. A tier with no shafts at all
 * (Minimal: its gaps' pools alone) builds no shaft draw.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    instanceIndex,
    length,
    vec2,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    screenUV,
    sin,
    smoothstep,
    step,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    AMBIENT_SHAFTS,
    EVENT_ROWS,
    EVENT_SLOTS,
    GAP_MASK,
    MOTES,
    RAIN,
    SHAFT_LIGHT,
    TAU,
    rbAirTransmittance,
    rbDrown,
    rbFleck,
    rbFxMaterial,
    rbHash21,
    rbHgMix,
    rbPart,
} from './rainbark-tsl.js';

/** The drops draw after the shafts. */
const DROP_ORDER = 73;

/**
 * The drops (the Sunshower's rain): `count` instanced streaks, closed form in the clock. Each slot
 * falls down its column again and again; every pass stands it somewhere new in the volume.
 */
function createDrops(u, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = count;
    const material = rbFxMaterial('RainbarkDrops');
    const vLight = varying(vec3(0.0), 'rbDropLight');
    const vAcross = varying(float(0.0), 'rbDropAcross');
    const vAlong = varying(float(0.0), 'rbDropAlong');
    material.positionNode = Fn(() => {
        const i = float(instanceIndex).toVar();
        const shown = step(i.add(0.5), u.rain.mul(count)).toVar();
        const h0 = rbHash21(vec2(i, 1.7));
        const fallen = u.time.mul(RAIN.speed).add(h0.mul(RAIN.height)).toVar();
        const pass = floor(fallen.div(RAIN.height));
        const at = fallen.sub(pass.mul(RAIN.height));
        const hx = rbHash21(vec2(i, pass.mul(0.37).add(3.1)));
        const hz = rbHash21(vec2(i.mul(1.31), pass.mul(0.53).add(7.7)));
        // A volume in front of the eye, deeper and wider on the open, sunlit right.
        const z = mix(float(RAIN.near), float(RAIN.far), hz.mul(hz)).negate();
        const x = mix(float(RAIN.left), float(RAIN.right), hx).mul(z.negate().div(RAIN.far).mul(0.7).add(0.3));
        const head = vec3(x, u.camY.add(RAIN.top).sub(at), z).toVar();
        const toEye = normalize(cameraPosition.sub(head));
        const side = normalize(vec3(toEye.z, 0.0, toEye.x.negate()).add(vec3(1e-6, 0.0, 0.0)));
        const dist = length(cameraPosition.sub(head)).toVar();
        // (Never longer on screen than RAIN.streakPx pixels: near the eye a world-length streak
        // would cross the frame as a scratch on the lens.)
        const len = min(float(RAIN.length).mul(u.rainLength), dist.mul(u.pixelAngle).mul(RAIN.streakPx));
        const width = max(dist.mul(u.pixelAngle).mul(2.0), 0.008);
        // Out of the card's band (the post would calm it, but a streak across the board distracts).
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(head, 1.0)).toVar();
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const away = max(max(r.x.sub(scr.x), scr.x.sub(r.z)), max(r.y.sub(scr.y), scr.y.sub(r.w)));
        const keep = shown.mul(step(0.01, away)).mul(step(0.0, clip.w));
        // Its light: the canopy's at its place (a glint in a fleck, faint in the shade), the sky's
        // a little, through the air.
        const fl = rbFleck(u, head, { lod: 'fixed' }).mul(u.fleckLight);
        // (Backlit toward the sun a drop shines whatever lights it: the haze's forward scatter.)
        const toward = rbHgMix(dot(normalize(head.sub(cameraPosition)), u.sunDir), float(0.75));
        const glint = u.sunCol.mul(fl.mul(RAIN.glint).add(toward.mul(RAIN.backlit))).add(u.col.sky.mul(RAIN.shade));
        // (The nearest drops, crossing the dark Elder, glint less: RAIN.nearDim.)
        const nearK = mix(float(RAIN.nearDim[2]), float(1.0), smoothstep(RAIN.nearDim[0], RAIN.nearDim[1], dist));
        vLight.assign(glint.mul(rbAirTransmittance(u, head)).mul(keep).mul(u.iris).mul(nearK));
        vAcross.assign(positionGeometry.x);
        vAlong.assign(positionGeometry.y);
        return head.add(side.mul(positionGeometry.x.mul(width).mul(keep))).sub(vec3(0.0, positionGeometry.y.mul(len).mul(keep), 0.0));
    })();
    material.colorNode = Fn(() => {
        const x = clamp(vAcross, -1.0, 1.0);
        // (Soft at both ends: a streak of motion, never a dash.)
        const s = clamp(vAlong, 0.0, 1.0);
        const ends = s.mul(float(1.0).sub(s)).mul(4.0);
        return vec4(max(vLight, vec3(0.0)).mul(float(1.0).sub(x.mul(x))).mul(ends), 0.0);
    })();
    const part = rbPart('RainbarkDrops', geometry, material, DROP_ORDER);
    part.count = count;
    return part;
}

/** The motes draw after the drops. */
const MOTE_ORDER = 74;

/**
 * The motes (MOTES): `count` instanced specks, closed form in the clock. Each slot is one mote for
 * good: a depth, a place across the lens's width there and a height in its band, world-fixed and
 * wrapped round the eye, drifting and wandering; lit per vertex by the canopy's light at its place.
 */
function createMotes(u, count) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = count;
    const material = rbFxMaterial('RainbarkMotes');
    const vLight = varying(vec3(0.0), 'rbMoteLight');
    const vAt = varying(vec2(0.0), 'rbMoteAt');
    const M = MOTES;
    material.positionNode = Fn(() => {
        const i = float(instanceIndex).toVar();
        const h1 = rbHash21(vec2(i, 3.7)).toVar();
        const h2 = rbHash21(vec2(i, 8.3)).toVar();
        const h3 = rbHash21(vec2(i.mul(1.7), 1.1)).toVar();
        const h4 = rbHash21(vec2(i, 13.9)).toVar();
        const t = u.time;
        // Its depth (more of them near the eye), and a slow wander both ways.
        const d = mix(float(M.near), float(M.far), h1.mul(h1)).toVar();
        const wx = sin(t.mul(mix(float(TAU / 13), float(TAU / 7), h2)).add(h3.mul(TAU))).mul(M.wander[0]);
        const wy = sin(t.mul(mix(float(TAU / 18), float(TAU / 9), h4)).add(h2.mul(TAU))).mul(M.wander[1]);
        // Across: the lens's width at that depth (and a little more), wrapped round the eye.
        const W = u.tanHalf.x.mul(d).mul(2 * M.spread).toVar();
        const xRaw = h2.mul(W).add(t.mul(M.drift[0])).add(wx);
        const fx = fract(xRaw.sub(u.camPos.x).div(W).add(0.5)).toVar();
        // Up: its band about the eye at that depth, sinking; world-fixed, so the eye's own rise
        // (a Climb) streams the motes down past it.
        const H = d.mul(M.rise[1] - M.rise[0]).toVar();
        const lo = u.camPos.y.add(d.mul(M.rise[0])).toVar();
        const yRaw = h3.mul(H).sub(t.mul(M.drift[1])).add(wy);
        const fy = fract(yRaw.sub(lo).div(H)).toVar();
        const P = vec3(u.camPos.x.add(fx.sub(0.5).mul(W)), lo.add(fy.mul(H)), u.camPos.z.sub(d)).toVar();
        const edges = smoothstep(0.0, M.edge, fx).mul(smoothstep(0.0, M.edge, float(1.0).sub(fx)))
            .mul(smoothstep(0.0, M.edge, fy))
            .mul(smoothstep(0.0, M.edge, float(1.0).sub(fy)));
        // Out of the card's band.
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(P, 1.0)).toVar();
        const ndc = clip.xy.div(max(abs(clip.w), 1e-4));
        const scr = vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
        const r = u.cardRect;
        const away = max(max(r.x.sub(scr.x), scr.x.sub(r.z)), max(r.y.sub(scr.y), scr.y.sub(r.w)));
        const keep = smoothstep(0.0, M.card, away).mul(step(0.0, clip.w)).mul(edges).toVar();
        // Its light: the canopy's at its place (glinting in the sun's patches, more toward the sun,
        // in brief flashes as it tumbles), a trace of the sky's in the shade; through the air, and
        // gone down in the vapour.
        const fl = rbFleck(u, P, { lod: 'fixed' }).mul(u.fleckLight);
        const toward = rbHgMix(dot(normalize(P.sub(cameraPosition)), u.sunDir), float(M.g));
        const s = max(sin(t.mul(mix(float(M.twinkle[0]), float(M.twinkle[1]), h4)).add(h1.mul(29.0))), 0.0);
        const s2 = s.mul(s);
        const tumble = s2.mul(s2).mul(s2).mul(M.flash * 3).add(1 - M.flash);
        const sun = u.sunCol.mul(fl.mul(toward.mul(M.backlit).add(1.0)).mul(tumble).mul(M.glint));
        // (In the shade only a trace of the sky's: lit by the bright air round it, every mote would
        // show at once, a snowfall. In a pearly zone the sun is veiled: MOTES.pearl.)
        const light = sun.add(u.col.sky.mul(M.shade)).mul(float(1.0).sub(u.pearl.mul(M.pearl)));
        const clear = float(1.0).sub(rbDrown(u, P.y));
        vLight.assign(light.mul(rbAirTransmittance(u, P)).mul(clear).mul(keep));
        vAt.assign(positionGeometry.xy);
        // A speck `px` pixels across on a 1080-line frame, never under `least` of a buffer pixel;
        // the quad twice that, for its soft fall.
        const dist = length(cameraPosition.sub(P));
        const angle = max(u.tanHalf.y.mul(2 / 1080).mul(mix(float(M.px[0]), float(M.px[1]), h4)), u.pixelAngle.mul(M.least));
        const half = dist.mul(angle).mul(step(0.001, keep));
        return P.add(u.camRight.mul(positionGeometry.x.mul(half))).add(u.camUp.mul(positionGeometry.y.mul(half)));
    })();
    material.colorNode = Fn(() => {
        const at = clamp(vAt, -1.0, 1.0);
        const spot = exp(dot(at, at).mul(-4.0));
        return vec4(max(vLight, vec3(0.0)).mul(spot), 0.0);
    })();
    const part = rbPart('RainbarkMotes', geometry, material, MOTE_ORDER);
    part.count = count;
    return part;
}

/** Segments along a shaft (its light and air are found per vertex). */
const SHAFT_SEGMENTS = 16;
/** Floats per shaft record: (x, z, width, rise) and (salt, kind 0 ambient / 1 combo, gap slot, 0). */
export const SHAFT_STRIDE = 8;
/** The shafts draw after the mist and the curls, among the additive effects. */
const SHAFT_ORDER = 72;

/**
 * The shafts' records for a tier: its ambient shafts (AMBIENT_SHAFTS, the first `ambient`), then a
 * combo shaft per gap slot (`combo` of them).
 */
export function shaftRecords(ambient, combo) {
    const a = Math.max(0, Math.min(AMBIENT_SHAFTS.length, Math.round(ambient) || 0));
    const c = Math.max(0, Math.min(EVENT_SLOTS.gaps, Math.round(combo) || 0));
    const data = new Float32Array((a + c) * SHAFT_STRIDE);
    for (let i = 0; i < a; i++) {
        const s = AMBIENT_SHAFTS[i];
        data.set([s.x, s.z, s.width, s.rise, s.salt, 0, 0, 0], i * SHAFT_STRIDE);
    }
    for (let i = 0; i < c; i++) data.set([0, 0, 0, 0, (i + 1) * 0.137, 1, i, 0], (a + i) * SHAFT_STRIDE);
    return { data, ambient: a, combo: c };
}

/** A strip of SHAFT_SEGMENTS quads: x across (−1 … 1), y along (0 at its foot … 1 at its top). */
function stripGeometry(records) {
    const corners = [];
    for (let j = 0; j <= SHAFT_SEGMENTS; j++) corners.push(-1, j / SHAFT_SEGMENTS, 0, 1, j / SHAFT_SEGMENTS, 0);
    const index = [];
    for (let j = 0; j < SHAFT_SEGMENTS; j++) {
        const a = j * 2;
        index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex(index);
    const buffer = new THREE.InstancedInterleavedBuffer(records, SHAFT_STRIDE, 1);
    geometry.setAttribute('aShaft', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aShaftLook', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.instanceCount = records.length / SHAFT_STRIDE;
    return geometry;
}

/** The shafts' draw over `records` (shaftRecords). */
function createShafts(u, records) {
    const geometry = stripGeometry(records.data);
    const material = rbFxMaterial('RainbarkShafts');
    const aShaft = attribute('aShaft', 'vec4');
    const aLook = attribute('aShaftLook', 'vec4');
    const vAcross = varying(float(0.0), 'rbShaftAcross');
    const vAt = varying(vec3(0.0), 'rbShaftAt');
    const vCol = varying(vec3(0.0), 'rbShaftLight');
    const S = SHAFT_LIGHT;

    material.positionNode = Fn(() => {
        const L = u.sunDir;
        const combo = step(0.5, aLook.y).toVar();
        const slot = floor(aLook.z.add(0.5));
        // A combo shaft: from its gap (drifting with the canopy) down to just under the eye.
        const gap = u.events.element(slot.add(EVENT_ROWS.gaps)).toVar();
        const gapTop = vec3(gap.x.add(u.wind.x.mul(GAP_MASK.tile)), u.canopyY, gap.y.add(u.wind.y.mul(GAP_MASK.tile)));
        const open = clamp(gap.w, 0.0, 1.0).toVar();
        // An ambient shaft: through its point at the eye's storey, from the mist's top to its lit
        // span's soft top.
        const anchorAmbient = vec3(aShaft.x, u.camY.add(aShaft.w), aShaft.y);
        const anchor = mix(anchorAmbient, gapTop, combo).toVar();
        const foot = mix(u.tide, u.camY.sub(S.land), combo);
        const head = mix(u.camY.add(S.top + S.soften), u.canopyY, combo);
        const y = mix(foot, head, positionGeometry.y).toVar();
        const onRay = anchor.add(L.mul(y.sub(anchor.y).div(max(L.y, 0.2)))).toVar();
        // Turned round the ray to face the camera; a shut gap's shaft has no width.
        const side = normalize(cross(L, normalize(cameraPosition.sub(onRay))).add(vec3(1e-6, 0.0, 0.0)));
        // (A combo gap's shaft is broader than the gap: a beam of lit haze, never a laser line.)
        const width = mix(aShaft.z, gap.z.mul(3.4).mul(step(0.01, open)), combo);
        const P = onRay.add(side.mul(positionGeometry.x.mul(width).mul(0.5))).toVar();
        // Its light, per vertex: lit over its span (soft ends), the haze's density along it (relative
        // to the zone's tide top), the mist standing high, the sun forward-scattered toward the eye,
        // the air in front of it.
        const ambientEnds = smoothstep(u.tide.add(S.bottom), u.tide.add(S.bottom + S.soften), y)
            .mul(float(1.0).sub(smoothstep(u.camY.add(S.top), u.camY.add(S.top + S.soften), y)));
        const comboEnds = smoothstep(foot, foot.add(S.landFade), y).mul(open).mul(u.iris);
        const ends = mix(ambientEnds, comboEnds, combo);
        const density = exp(clamp(y.sub(u.hazeY), 0.0, 400.0).div(u.scaleHeight).negate());
        const tide = mix(float(S.tide[0]), float(S.tide[1]), u.tideHigh);
        const scatter = rbHgMix(dot(normalize(onRay.sub(cameraPosition)), L), float(S.g));
        // (A combo beam reads whatever its angle to the sun: SHAFT_LIGHT.combo.)
        const toward = mix(scatter, max(scatter, S.combo.floor).mul(S.combo.gain), combo);
        const T = rbAirTransmittance(u, P);
        // (In a pearly zone, the Fog Line, the ambient shafts are god-rays through the vapour: the
        // light design of a frame that is otherwise all pearl.)
        const pearly = u.pearl.mul(S.pearl).mul(float(1.0).sub(combo)).add(1.0);
        const shine = toward.mul(density).mul(tide).mul(ends)
            .mul(T)
            .mul(S.k)
            .mul(pearly)
            .mul(u.fleckLight);
        vCol.assign(u.sunCol.mul(shine));
        vAcross.assign(positionGeometry.x);
        vAt.assign(vec3(y, aLook.x, 0.0));
        return P;
    })();

    material.colorNode = Fn(() => {
        // A soft slab across (1 − x²: lit haze, not a thin ray).
        const x = clamp(vAcross, -1.0, 1.0);
        const soft = float(1.0).sub(x.mul(x));
        const profile = soft.mul(soft);
        // Slow motes and streaks drifting down the shaft.
        const salt = vAt.y;
        const at = vec3(
            x.mul(SHAFT_LIGHT.streaks).add(salt.mul(17.0)),
            vAt.x.add(u.time.mul(SHAFT_LIGHT.drift)).mul(0.08),
            u.time.mul(0.05).add(salt.mul(5.0)),
        );
        const streaks = clamp(u.noise3(at).x.sub(0.5).mul(1.4).add(0.8), 0.0, 2.0);
        // (Never across the card: a beam fades out over the last of the way to it, as the rain does.)
        const r = u.cardRect;
        const away = max(max(r.x.sub(screenUV.x), screenUV.x.sub(r.z)), max(r.y.sub(screenUV.y), screenUV.y.sub(r.w)));
        const clear = smoothstep(SHAFT_LIGHT.card[0], SHAFT_LIGHT.card[1], away);
        return vec4(max(vCol, vec3(0.0)).mul(profile.mul(streaks)).mul(clear), 0.0);
    })();

    const part = rbPart('RainbarkShafts', geometry, material, SHAFT_ORDER);
    part.ambient = records.ambient;
    part.combo = records.combo;
    return part;
}

/**
 * The effects part, or null when the tier has none of them yet (Minimal: no shafts).
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (its ambient and combo shafts)
 */
export function createFx(u, tier = {}) {
    const records = shaftRecords(tier.shaftsAmbient ?? AMBIENT_SHAFTS.length, tier.shaftsCombo ?? EVENT_SLOTS.gaps);
    const shafts = records.ambient + records.combo > 0 ? createShafts(u, records) : null;
    const drops = (tier.drops || 0) > 0 ? createDrops(u, tier.drops) : null;
    const motes = (tier.motes || 0) > 0 ? createMotes(u, tier.motes) : null;
    if (!shafts && !drops && !motes) return null;
    const group = new THREE.Group();
    group.name = 'RainbarkFx';
    if (shafts) group.add(shafts.mesh);
    if (drops) group.add(drops.mesh);
    if (motes) group.add(motes.mesh);
    return {
        mesh: group,
        material: null,
        geometry: null,
        shafts,
        drops,
        motes,
        dispose() {
            [shafts, drops, motes].forEach((p) => {
                p?.geometry.dispose();
                p?.material.dispose();
            });
        },
    };
}
