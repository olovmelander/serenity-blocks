/**
 * Rainbark — the effects layer (§4.8). For now: the shafts.
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
 * Every slot is drawn on every frame (a shut gap's shaft has no width), so the first frame compiles
 * the pipeline and the scene never changes after it is built. A tier with no shafts at all
 * (Minimal: its gaps' pools alone) builds no shaft draw.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    max,
    mix,
    normalize,
    positionGeometry,
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
    SHAFT_LIGHT,
    rbAirTransmittance,
    rbFxMaterial,
    rbHgMix,
    rbPart,
} from './rainbark-tsl.js';

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
        const width = mix(aShaft.z, gap.z.mul(2.0).mul(step(0.01, open)), combo);
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
        const toward = rbHgMix(dot(normalize(onRay.sub(cameraPosition)), L), float(S.g));
        const T = rbAirTransmittance(u, P);
        const shine = toward.mul(density).mul(tide).mul(ends)
            .mul(T)
            .mul(S.k)
            .mul(u.fleckLight);
        vCol.assign(u.sunCol.mul(shine));
        vAcross.assign(positionGeometry.x);
        vAt.assign(vec3(y, aLook.x, 0.0));
        return P;
    })();

    material.colorNode = Fn(() => {
        // A soft slab across (1 − x²: lit haze, not a thin ray).
        const x = clamp(vAcross, -1.0, 1.0);
        const profile = float(1.0).sub(x.mul(x));
        // Slow motes and streaks drifting down the shaft.
        const salt = vAt.y;
        const at = vec3(
            x.mul(SHAFT_LIGHT.streaks).add(salt.mul(17.0)),
            vAt.x.add(u.time.mul(SHAFT_LIGHT.drift)).mul(0.08),
            u.time.mul(0.05).add(salt.mul(5.0)),
        );
        const streaks = clamp(u.noise3(at).x.sub(0.5).mul(1.4).add(0.8), 0.0, 2.0);
        return vec4(max(vCol, vec3(0.0)).mul(profile.mul(streaks)), 0.0);
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
    if (records.ambient + records.combo === 0) return null;
    const shafts = createShafts(u, records);
    const group = new THREE.Group();
    group.name = 'RainbarkFx';
    group.add(shafts.mesh);
    return {
        mesh: group,
        material: null,
        geometry: null,
        shafts,
        dispose() {
            shafts.geometry.dispose();
            shafts.material.dispose();
        },
    };
}
