/**
 * Rainbark — the trunks: the painted giants themselves.
 *
 * One unit tube (θ/2π around, h up, on a grid with a closing seam at the back) drawn as two
 * instanced draws that share the bark builder (rbBark):
 *   near  the Elder, the Sisters, R1a and R1b (≤ 8 slots, a fine grid; the event-aware draw);
 *   far   everything else in the grove (a coarse grid, the cheaper bark: no edge cut, no
 *         specular), with room for the limbs.
 * Each instance is one record of 16 floats in ONE interleaved instance buffer per draw (aBase,
 * aSpan, aLean, aCode; trunkRecord in the core), so a draw binds two vertex buffers.
 *
 * The vertex stage builds the trunk from positionGeometry (there are no instance matrices): the
 * spine leans, bows and sways; the radius tapers; gentle flutes spiral up it; smooth buttress
 * fins flare into the floor, and a cap closes the foot. Nothing rises past the canopy plane (the
 * tube is clamped there, so a trunk or a limb enters the backdrop's lace where it meets it). The normal is analytic (∂P/∂θ × ∂P/∂y
 * written out, no dFdx), without the flutes, whose tilt the fragment adds per pixel (finer than
 * the grid). Slots with no trunk are collapsed to nothing, so every pipeline compiles on the
 * first frame and the scene never changes after it is built.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    round,
    sin,
    smoothstep,
    sqrt,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BARK_TILE,
    CANOPY_SHADE,
    CANOPY_SHADE_FAR,
    LIMB_GROUP,
    LIMB_INTO,
    TAU,
    TRUNK_FLUTE,
    TRUNK_STRIDE,
    limbRecord,
    rbBark,
    rbHash21,
    rbPart,
    trunkRecord,
} from './rainbark-tsl.js';

/** Floats per instance record (the core's), and the near draw's slots (the heroes plus local-MP spares). */
export { TRUNK_STRIDE };
export const NEAR_SLOTS = 8;

/**
 * The bark's ribbons are drawn out up a trunk that stands deep: by 1 + gain·smoothstep(near, far,
 * depth) (metres from the rest eye), so at 20–50 m they read as long ribbons, the Elder's untouched.
 */
export const BARK_STRETCH = Object.freeze({ near: 14, far: 44, gain: 1.2 });

/** Seconds per sway cycle of the two axes (a 170 m trunk sways slowly). */
const SWAY_PERIODS = [9.1, 12.1];

/**
 * The unit tube: (θ/2π, h, 0) on (around + 1) × (up + 1) vertices (the seam column duplicated), its
 * triangles wound counter-clockwise seen from outside; then a cap ring (θ/2π, 0, 1) that the
 * vertex stage collapses onto the axis at the trunk's foot, closing its bottom with a fan facing
 * down.
 */
export function createTubeGeometry(around, up) {
    const nAround = Math.max(3, Math.round(around));
    const nUp = Math.max(1, Math.round(up));
    const ring = nAround + 1;
    const capBase = ring * (nUp + 1);
    const positions = new Float32Array((capBase + ring) * 3);
    for (let j = 0; j <= nUp; j++) {
        for (let i = 0; i <= nAround; i++) {
            const o = (j * ring + i) * 3;
            positions[o] = i / nAround;
            positions[o + 1] = j / nUp;
        }
    }
    for (let i = 0; i <= nAround; i++) {
        const o = (capBase + i) * 3;
        positions[o] = i / nAround;
        positions[o + 2] = 1;
    }
    const index = new Uint32Array((nAround * nUp + nAround) * 6 - nAround * 3);
    let k = 0;
    for (let j = 0; j < nUp; j++) {
        for (let i = 0; i < nAround; i++) {
            const a = j * ring + i;
            const b = a + 1;
            const c = a + ring;
            const d = c + 1;
            // Up the trunk first, then round it: (∂P/∂y) × (∂P/∂θ) points out of the bark.
            index[k++] = a;
            index[k++] = c;
            index[k++] = b;
            index[k++] = b;
            index[k++] = c;
            index[k++] = d;
        }
    }
    // The foot: from the axis out to the bottom ring and round it, which faces down.
    for (let i = 0; i < nAround; i++) {
        index[k++] = capBase + i;
        index[k++] = i;
        index[k++] = i + 1;
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
}

/**
 * The CPU twin of the vertex stage's surface, for tests and placement: the point and the base
 * normal (no flutes, no fins, no sway) of a record at (θ/2π, h), or on the cap at the foot.
 */
export function trunkSurface(record, a, h, offset = 0, cap = 0) {
    const r = (i) => record[offset + i];
    const seed = Math.floor(r(14) + 0.5);
    const theta = a * TAU;
    const y0 = r(4);
    const span = Math.max(r(5) - y0, 1);
    const y = y0 + (r(5) - y0) * h;
    const yy = y - y0;
    const bow = seed * 0.6180339887;
    const bowAz = (bow - Math.floor(bow)) * TAU;
    const bx = Math.cos(bowAz);
    const bz = Math.sin(bowAz);
    const spine = [r(0) + r(8) * yy + (bx * r(10) * yy * yy) / span, r(1) + r(9) * yy + (bz * r(10) * yy * yy) / span];
    const ry = cap ? 0 : r(2) * (1 - (r(3) * yy) / span);
    const n = cap ? [0, -1, 0] : [Math.cos(theta), 0, Math.sin(theta)];
    return {
        position: [spine[0] + Math.cos(theta) * ry, y, spine[1] + Math.sin(theta) * ry],
        normal: n,
        radius: ry,
        spine,
    };
}

/**
 * The buttress fin's profile across θ: ((1 + cos x)/2)⁴ (a smooth crest that flares into the
 * bole with no crease), its derivative, and its integral from 0 (for the bark's arc length):
 *   ∫ = (35x + 56 sin x + 14 sin 2x + (8/3) sin 3x + ¼ sin 4x) / 128, mean 35/128.
 */
const FIN_MEAN = 35 / 128;
const finIntegral = (x) => x.mul(35.0)
    .add(sin(x).mul(56.0))
    .add(sin(x.mul(2.0)).mul(14.0))
    .add(sin(x.mul(3.0)).mul(8 / 3))
    .add(sin(x.mul(4.0)).mul(0.25))
    .div(128.0);

/** The bark material of one draw: the tube built in the vertex stage, rbBark in the fragment. */
function trunkMaterial(name, u, {
    atlasSize, detail, fine, canopyFade, billows, fleckLod, pools, lite,
}) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.name = name;
    material.fog = false;
    material.depthWrite = true;
    const aBase = attribute('aBase', 'vec4');
    const aSpan = attribute('aSpan', 'vec4');
    const aLean = attribute('aLean', 'vec4');
    const aCode = attribute('aCode', 'vec4');
    const vBark = varying(vec4(0.0), 'rbTrunkBark');
    const vNrm = varying(vec3(0.0, 1.0, 0.0), 'rbTrunkNormal');
    const vInst = varying(vec4(0.0), 'rbTrunkInst');
    const vFlute = varying(vec2(0.0), 'rbTrunkFlute');
    const vWorld = varying(vec3(0.0), 'rbTrunkWorld');
    const vLimb = varying(vec2(0.0), 'rbTrunkLimb');

    material.positionNode = Fn(() => {
        const a = positionGeometry.x;
        const theta = a.mul(TAU).toVar();
        const y0 = aSpan.x;
        const span = max(aSpan.y.sub(y0), 1.0).toVar();
        // Nothing rises past the canopy plane: there every trunk and limb enters the painted lace.
        const y = min(mix(y0, aSpan.y, positionGeometry.y), u.canopyY).toVar();
        const yy = y.sub(y0).toVar();
        const k = yy.div(span).toVar();
        const seed = floor(aCode.z.add(0.5)).toVar();
        // ── The spine: lean, a bow in the seed's direction, the sway growing up the trunk ──
        const bowAz = fract(seed.mul(0.6180339887)).mul(TAU);
        const bow = vec2(cos(bowAz), sin(bowAz)).mul(aLean.z);
        const swayPhase = seed.mul(1.7);
        const sway = vec2(
            sin(u.time.mul(TAU / SWAY_PERIODS[0]).add(swayPhase)),
            sin(u.time.mul(TAU / SWAY_PERIODS[1]).add(swayPhase.mul(1.3))),
        ).mul(aLean.w);
        const spine = aBase.xy.add(aLean.xy.mul(yy)).add(bow.mul(yy.mul(k))).add(sway.mul(k.mul(k)));
        const spineD = aLean.xy.add(bow.mul(k.mul(2.0))).add(sway.mul(k.mul(2.0).div(span)));
        // ── The radius: taper, flutes, buttress fins at the floor ──
        const radius = aBase.z.mul(k.mul(aBase.w).oneMinus()).toVar();
        const radiusD = aBase.z.mul(aBase.w).div(span).negate();
        const counts = floor(aCode.w.add(0.5));
        const fins = floor(counts.add(0.5).div(16.0));
        const flutes = counts.sub(fins.mul(16.0));
        const flutePhase = rbHash21(vec2(seed, 1.7)).mul(TAU);
        const finPhase = rbHash21(vec2(seed, 5.3)).mul(TAU);
        const fluteArg = flutes.mul(theta).add(flutePhase).add(y.mul(TRUNK_FLUTE.twist));
        const flute = cos(fluteArg).mul(TRUNK_FLUTE.amp);
        const fluteD = sin(fluteArg).mul(-TRUNK_FLUTE.amp * TRUNK_FLUTE.twist);
        const finArg = fins.mul(theta).add(finPhase).toVar();
        // A limb (no fins) wears its collar as a ring all round its foot instead.
        const crest = mix(float(1.0), cos(finArg).add(1.0).mul(0.5), step(0.5, fins));
        const crest2 = crest.mul(crest);
        const hb = max(aSpan.w, 0.5);
        const fall = exp(max(yy, 0.0).div(hb).min(30.0).negate());
        const finAmp = aSpan.z.mul(fall).toVar();
        const fin = finAmp.mul(crest2.mul(crest2)).toVar();
        const finTheta = finAmp.mul(sin(finArg).mul(-2.0).mul(crest2.mul(crest))).mul(fins);
        const r = radius.mul(flute.add(1.0)).add(fin);
        const rTheta = finTheta;
        const rY = radiusD.mul(flute.add(1.0)).add(radius.mul(fluteD)).sub(fin.div(hb));
        const out = vec3(cos(theta), 0.0, sin(theta));
        const tangent = vec3(sin(theta).negate(), 0.0, cos(theta));
        // The cap ring (z = 1) collapses onto the axis at the foot, facing down.
        const capK = positionGeometry.z;
        const axis = vec3(spine.x, y, spine.y);
        const P = mix(axis.add(out.mul(r)), axis, capK).toVar();
        const dTheta = out.mul(rTheta).add(tangent.mul(r));
        const dY = vec3(spineD.x, 1.0, spineD.y).add(out.mul(rY));
        // A collapsed (dormant) slot has no area to shade: the epsilon only keeps its normal finite.
        const wall = normalize(cross(dY, dTheta).add(vec3(0.0, 0.0, 1e-7)));
        vNrm.assign(normalize(mix(wall, vec3(0.0, -1.0, 0.0), capK)));
        // ── Bark space: whole tiles round the trunk, offset per trunk. Round it, s follows the arc
        // length (fins and all), so the bark is not stretched across a buttress fin. ──
        const kRep = max(round(aBase.z.mul(TAU / BARK_TILE.around)), 1.0);
        const finArc = finAmp.mul(finIntegral(finArg).sub(finIntegral(finPhase))).div(max(fins, 1.0));
        const arc = radius.mul(theta).add(finArc);
        const perimeter = max(radius.add(finAmp.mul(FIN_MEAN)).mul(TAU), 1e-4);
        const s = arc.div(perimeter).mul(kRep).add(rbHash21(vec2(seed, 9.1)));
        // Up the bark: metres along the spine (a slanting limb's ribbons run along it, not up the
        // world), the ribbons drawn out on a trunk standing deep (at 20–50 m a ribbon a few metres
        // long would read as a short lozenge). The depth is the rest eye's (the axis's distance
        // from x = z = 0), so the camera's breath never slides the bark.
        const along = y0.add(yy.mul(sqrt(dot(aLean.xy, aLean.xy).add(1.0)))).toVar();
        const depth = length(aBase.xy);
        const stretch = smoothstep(BARK_STRETCH.near, BARK_STRETCH.far, depth).mul(BARK_STRETCH.gain).add(1.0);
        const v = along.div(stretch.mul(BARK_TILE.up)).add(rbHash21(vec2(seed, 3.3)).mul(5.0));
        vBark.assign(vec4(s, v, theta, along));
        // A limb carries its parent's group plus LIMB_GROUP: the bark reads the group alone.
        const groupCode = floor(aCode.y.add(0.5));
        const isLimb = step(LIMB_GROUP - 0.5, groupCode);
        vInst.assign(vec4(aCode.x, groupCode.sub(isLimb.mul(LIMB_GROUP)), seed, kRep));
        // A limb, and how far along it this is into the run where it melts into the leaves
        // (LIMB_INTO: by its length, from whatever height it is seen).
        vLimb.assign(vec2(isLimb, isLimb.mul(smoothstep(LIMB_INTO, 1.0, k))));
        vFlute.assign(vec2(flutes, flutePhase));
        // The mesh's matrix is the identity: the displaced position is the world position.
        vWorld.assign(P);
        return P;
    })();

    material.colorNode = Fn(() => {
        const col = rbBark(u, {
            P: vWorld, N: normalize(vNrm), bark: vBark, inst: vInst, flute: vFlute, limb: vLimb,
        }, {
            atlasSize, detail, fine, canopyFade, billows, fleckLod, pools, lite,
        });
        return vec4(max(col, vec3(0.0)), 1.0);
    })();
    return material;
}

/** One instanced draw of `slots` trunk records. */
function trunkDraw(name, u, slots, grid, options, renderOrder) {
    const geometry = createTubeGeometry(grid[0], grid[1]);
    const data = new Float32Array(slots * TRUNK_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, TRUNK_STRIDE, 1);
    geometry.setAttribute('aBase', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
    geometry.setAttribute('aSpan', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
    geometry.setAttribute('aLean', new THREE.InterleavedBufferAttribute(buffer, 4, 8));
    geometry.setAttribute('aCode', new THREE.InterleavedBufferAttribute(buffer, 4, 12));
    // Every slot is drawn; a slot with no trunk is all zeros: no radius, no height, no area.
    geometry.instanceCount = slots;
    const material = trunkMaterial(name, u, options);
    const part = rbPart(name, geometry, material, renderOrder);
    part.data = data;
    part.buffer = buffer;
    part.slots = slots;
    part.used = 0;
    return part;
}

/**
 * The trunks part: a group of the near and the far draw.
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (rainbark-quality.js)
 * @param {object} [options]
 * @param {number} [options.atlasSize]  the patch atlas's size (texels a side)
 * @param {number} [options.farSlots]   slots of the far draw (the grove plan's trunks, the 21:9
 *                                      Twin and the limbs); fixed for the life of the part
 */
export function createTrunks(u, tier, { atlasSize = tier.atlas, farSlots = tier.trunks + (tier.limbs || 0) } = {}) {
    const bark = {
        atlasSize,
        detail: tier.striation === true,
        billows: Number.isFinite(tier.billows) ? tier.billows : 2,
        fleckLod: tier.fleckLod || 'pixel',
        lite: tier.canopy === 'lite',
    };
    // The near draw carries the combo gaps' pools (the far grove lies outside every station) and,
    // on the detail tiers, the torn edge and the wet glints.
    const near = trunkDraw('RainbarkTrunksNear', u, NEAR_SLOTS, tier.grids.near, {
        ...bark, fine: tier.striation === true, pools: true, canopyFade: CANOPY_SHADE,
    }, 10);
    // The far grove's tops fade into the canopy over a longer climb, so seen from below (an upright
    // phone looks up into the crown) they melt into the lace instead of ending as stubs.
    const far = trunkDraw('RainbarkTrunksFar', u, Math.max(2, farSlots), tier.grids.far, {
        ...bark, fine: false, pools: false, canopyFade: CANOPY_SHADE_FAR,
    }, 11);
    const group = new THREE.Group();
    group.name = 'RainbarkTrunks';
    group.add(near.mesh, far.mesh);
    const part = {
        mesh: group, material: null, geometry: null, near, far,
    };

    /** True when a slot holds a trunk (a collapsed slot has no height). */
    const live = (draw, slot) => draw.data[slot * TRUNK_STRIDE + 5] > draw.data[slot * TRUNK_STRIDE + 4];
    near.live = (slot) => live(near, slot);
    far.live = (slot) => live(far, slot);

    /**
     * Stand a trunk (as in HERO_TRUNKS) in a slot of a draw, its axis through (x, z) at pivotY;
     * null collapses the slot to nothing. Nothing is uploaded until commit().
     */
    part.stand = (draw, slot, trunk, seed, pivotY) => {
        if (slot < 0 || slot >= draw.slots) return;
        const at = slot * TRUNK_STRIDE;
        if (trunk) trunkRecord(trunk, seed, draw.data, at, pivotY);
        else draw.data.fill(0, at, at + TRUNK_STRIDE);
    };

    /** A limb (planGrove) in a far slot, out of the parent record in (draw, slot). */
    part.standLimb = (slot, limb, parentDraw, parentSlot) => {
        if (slot < 0 || slot >= far.slots) return;
        const at = slot * TRUNK_STRIDE;
        if (limb && parentDraw && live(parentDraw, parentSlot)) {
            limbRecord(limb, parentDraw.data, far.data, at, parentSlot * TRUNK_STRIDE);
        } else {
            far.data.fill(0, at, at + TRUNK_STRIDE);
        }
    };

    /** Upload a draw; `used` is one past its last live slot. */
    const upload = (draw) => {
        draw.used = 0;
        for (let slot = 0; slot < draw.slots; slot++) if (live(draw, slot)) draw.used = slot + 1;
        draw.buffer.needsUpdate = true;
    };
    part.commit = () => {
        upload(near);
        upload(far);
    };

    part.dispose = () => {
        [near, far].forEach((draw) => {
            draw.geometry.dispose();
            draw.material.dispose();
        });
    };
    return part;
}
