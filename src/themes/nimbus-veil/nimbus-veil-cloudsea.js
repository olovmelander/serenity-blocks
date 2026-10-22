/**
 * Nimbus Veil — the sea of clouds.
 *
 * A polar grid centred on the rest camera (dense near it, growing outward to the horizon)
 * displaced by a field of cumulus HEADS — round domes with flat crowns and steep flanks, joined
 * in soft creases (nvDomes) — riding on broad swells, with a mask that lets the heads tower in
 * some places and flatten into stratus in others. The deck drifts slowly toward the camera.
 *
 * The fragment re-evaluates the same field (plus two finer octaves of cauliflower in the normal
 * only, each faded out where it would be finer than a pixel) and lights it for a sun 9.5° above
 * the deck:
 *   - the low sun catches only the crowns and the flanks that face it: gold on violet;
 *   - every head throws a long shadow down-sun, found by a few taps of the field toward the
 *     sun (a ray that climbs at tan 9.5° per unit and meets a higher head is in shadow);
 *   - the towers throw long lanes of shadow across the deck toward the camera;
 *   - looking toward the sun, the thin grazing edges of the heads glow (a forward-scattering
 *     silver lining) and the far deck under the sun becomes a glare path;
 *   - the creases fill with soft mist, and distance dissolves everything into the colour of the
 *     air on that bearing's horizon (nvApplyHaze), which the sky shares.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    length,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import {
    RIG,
    SEA_WRAP,
    SUN_DIR,
    SUN_TAN,
    TOWERS,
    nvApplyHaze,
    nvDomes,
    nvDomesH,
    nvNoisedP,
    rgb,
} from './nimbus-veil-tsl.js';

/** Gaussian haze rate along the sea (1 / distance). */
export const SEA_HAZE = 1 / 1500;

/**
 * The field's octaves (world units). Every cell size divides SEA_WRAP, so the scroll wraps
 * seamlessly. Heights: the swell's full range, a head's top at full mask, the cauliflower's.
 */
export const SEA_FIELD = Object.freeze({
    swellCell: 320,
    swellH: 7,
    maskCell: 160,
    heapCell: 64,
    heapH: 6,
    headCell: 20,
    headH: 7,
    cauliCell: 8,
    cauliH: 2.4,
    fineCell: 3,
    fineH: 0.8,
    /** Subtracted so the deck's mean height sits near y = 0. */
    offset: 4,
});

/** Shadow taps toward the sun per tier (horizontal distances, world units). */
export const SEA_SHADOW_TAPS = Object.freeze({
    none: [],
    one: [14],
    two: [8, 26],
    four: [4, 11, 24, 45],
});

const F = SEA_FIELD;
const period = (cell) => SEA_WRAP / cell;

/** Polar grid around the rest camera: rings grow geometrically, azimuth spans the yaw range. */
function buildSeaGeometry(rings, segments) {
    const r0 = 9;
    const growth = (3600 / r0) ** (1 / rings);
    const span = THREE.MathUtils.degToRad(124); // ± from the sun direction (−z)
    const position = new Float32Array((rings + 1) * (segments + 1) * 3);
    const index = [];
    let v = 0;
    for (let k = 0; k <= rings; k += 1) {
        const r = r0 * growth ** k;
        for (let s = 0; s <= segments; s += 1) {
            const a = -span + (2 * span * s) / segments;
            position[v * 3] = RIG.x + Math.sin(a) * r;
            position[v * 3 + 1] = 0;
            position[v * 3 + 2] = RIG.z - Math.cos(a) * r;
            v += 1;
        }
    }
    const row = segments + 1;
    for (let k = 0; k < rings; k += 1) {
        for (let s = 0; s < segments; s += 1) {
            const a = k * row + s;
            const b = a + row;
            index.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(RIG.x, 0, RIG.z), 3700);
    return geometry;
}

/**
 * Every light-wave slot (P = radius, 1/width, energy, heat; a gaussian band) at `dist`: their summed light and its colour, gold for a plain wave and
 * molten amber for a hot one (a deep cascade, a long chain, a fever), weighted by each band's
 * light. `wide` widens the bands (the towers take them three times as wide).
 */
export function ringLight(rings, dist, wide = 1, knee = 0.8, room = 0.6) {
    const sum = float(0.0).toVar();
    const hot = float(0.0).toVar();
    rings.forEach((P) => {
        const d = dist.sub(P.x).mul(P.y).div(wide);
        const r = exp(d.mul(d).negate()).mul(P.z);
        sum.addAssign(r);
        hot.addAssign(r.mul(P.w));
    });
    const heat = clamp(hot.div(max(sum, 1e-4)), 0.0, 1.0);
    // Bands that overlap add up to a soft limit: one wave reads as it always has, a procession
    // never floods the deck or a tower with light (linear to `knee`, then easing to knee + room).
    const over = max(sum.sub(knee), 0.0);
    const light = min(sum, knee).add(over.div(over.div(room).add(1.0)));
    return { sum: light, heat };
}

/** Swell, mask and heads at field point q (world units, scrolled): their values and gradients. */
function baseField(q) {
    const sw = nvNoisedP(q.div(F.swellCell), period(F.swellCell)).toVar();
    const mk = nvNoisedP(q.div(F.maskCell).add(vec2(31.7, 0.0)), period(F.maskCell)).toVar();
    const hp = nvDomes(q.div(F.heapCell).add(vec2(-21.7, 0.0)), period(F.heapCell)).toVar();
    const hd = nvDomes(q.div(F.headCell), period(F.headCell)).toVar();
    // The mask: heads tower where it is high and flatten toward stratus where it is low.
    // m = 0.15 + 1.1·smoothstep(0.2, 0.85, mask), and its slope by the chain rule.
    const ms = clamp(mk.x.sub(0.2).div(0.65), 0.0, 1.0);
    const m = ms.mul(ms).mul(float(3.0).sub(ms.mul(2.0))).mul(1.1)
        .add(0.15)
        .toVar();
    const gradM = mk.yz.mul(ms.mul(float(1.0).sub(ms)).mul((6.0 * 1.1) / (0.65 * F.maskCell)));
    const swell = sw.x.sub(0.5).mul(F.swellH);
    const gradSwell = sw.yz.mul(F.swellH / F.swellCell).toVar();
    // Heaps (big domes) carry heads (smaller ones): both rise with the mask.
    const piled = hp.x.mul(F.heapH).add(hd.x.mul(F.headH)).toVar();
    const heads = piled.mul(m);
    // Slopes kept apart, so the small heads can fade with distance while the heaps stay.
    const gradHeap = gradM.mul(hp.x.mul(F.heapH)).add(hp.yz.mul(m.mul(F.heapH / F.heapCell)));
    const gradHead = gradM.mul(hd.x.mul(F.headH)).add(hd.yz.mul(m.mul(F.headH / F.headCell)));
    return {
        sw, mk, hp, hd, m, gradM, swell, gradSwell, heads, gradHeap, gradHead,
    };
}

/**
 * @param {object} u  shared world uniforms
 * @param {object} [opts]
 * @param {number} [opts.rings=180]     radial resolution
 * @param {number} [opts.segments=180]  angular resolution
 * @param {number[]} [opts.shadowTaps]  self-shadow taps toward the sun (world units)
 * @param {boolean} [opts.cauliflower]  the cauliflower octave in the normal
 * @param {boolean} [opts.fine]         the finest octave in the normal
 * @param {number} [opts.towers=0]      how many towers (prefix of TOWERS) throw shadows
 */
export function createCloudSea(u, opts = {}) {
    const geometry = buildSeaGeometry(opts.rings ?? 180, opts.segments ?? 180);
    const taps = opts.shadowTaps ?? SEA_SHADOW_TAPS.four;
    const withCauli = opts.cauliflower !== false;
    const withFine = opts.fine !== false;
    const towers = TOWERS.slice(0, Math.max(0, opts.towers ?? 0));
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'NimbusCloudSea';
    material.fog = false;

    // ── Displacement: swell + heads (+ the cauliflower near the lens, where the grid is fine
    // enough to carry it). The heads flatten far out, where the grid would undersample them and
    // the silhouettes would crawl as the deck drifts; the fragment's normal carries them on. ──
    material.positionNode = Fn(() => {
        const p = positionLocal;
        const q = vec2(p.x, p.z.sub(u.seaScroll));
        const r = length(vec2(p.x.sub(RIG.x), p.z.sub(RIG.z)));
        const f = baseField(q);
        const headsFade = float(1.0).sub(smoothstep(520.0, 1100.0, r));
        const h = f.swell.add(f.heads.mul(headsFade)).toVar();
        if (withCauli) {
            const near = float(1.0).sub(smoothstep(50.0, 140.0, r));
            const cl = nvDomes(q.div(F.cauliCell).add(vec2(u.time.mul(0.045).add(13.1), 0.0)), period(F.cauliCell));
            const crown = smoothstep(0.15, 0.7, f.hd.x);
            h.addAssign(cl.x.mul(F.cauliH).mul(crown.mul(0.6).add(0.4)).mul(near));
        }
        return vec3(p.x, h.sub(F.offset), p.z);
    })();

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const rel = p.sub(cameraPosition).toVar();
        const dist = length(vec2(rel.x, rel.z)).toVar();
        const q = vec2(p.x, p.z.sub(u.seaScroll)).toVar();
        // World units per pixel (geometric mean of the two axes: the depth axis is far coarser
        // than the lateral one at a grazing view).
        const fw = fwidth(q);
        const foot = sqrt(max(fw.x.mul(fw.y), 1e-8)).mul(1.4).toVar();

        const f = baseField(q);
        const crown = smoothstep(0.15, 0.7, f.hd.x).toVar();
        // Far out the heads flatten into the deck's texture, then into a plain.
        // Far out the heads flatten into the heaps' larger forms (their rows would read as
        // scales at a grazing view), and past that into a plain.
        const roomH = float(1.0).sub(smoothstep(0.2, 0.7, foot.div(F.headCell)))
            .mul(mix(float(1.0), float(0.3), smoothstep(220.0, 800.0, dist))).toVar();
        const roomHeap = float(1.0).sub(smoothstep(0.2, 0.7, foot.div(F.heapCell)));
        const height = f.swell.add(f.heads).toVar();
        const grad = f.gradSwell.add(f.gradHeap.mul(roomHeap)).add(f.gradHead.mul(roomH)).toVar();

        // ── Cauliflower: smaller heads on the big ones, in the normal only ──
        const cauli = float(0.0).toVar();
        if (withCauli) {
            const roomC = float(1.0).sub(smoothstep(0.12, 0.45, foot.div(F.cauliCell))).toVar();
            If(roomC.greaterThan(0.01), () => {
                // The small billows churn: they drift slowly across the big ones.
                const cl = nvDomes(q.div(F.cauliCell).add(vec2(u.time.mul(0.045).add(13.1), 0.0)), period(F.cauliCell));
                const a = crown.mul(0.6).add(0.4).mul(F.cauliH).mul(roomC);
                cauli.assign(cl.x);
                height.addAssign(cl.x.mul(a));
                grad.addAssign(cl.yz.mul(a.div(F.cauliCell)));
            });
        }
        if (withFine) {
            const roomF = float(1.0).sub(smoothstep(0.12, 0.45, foot.div(F.fineCell))).toVar();
            If(roomF.greaterThan(0.01), () => {
                const fn = nvDomes(q.div(F.fineCell).add(vec2(u.time.mul(-0.09).sub(5.3), 0.0)), period(F.fineCell));
                grad.addAssign(fn.yz.mul(roomF.mul(F.fineH / F.fineCell)));
            });
        }

        const n = normalize(vec3(grad.x.negate(), 1.0, grad.y.negate())).toVar();
        const V = normalize(rel).toVar();
        const L = vec3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);

        // ── Self-shadow: the ray toward the sun climbs SUN_TAN per unit; a higher head on its
        // way puts this point in shadow. The swell and the mask change slowly, so they are
        // carried along the taps by their gradients; each tap reads the heads again. ──
        const shadow = float(1.0).toVar();
        if (taps.length) {
            If(dist.lessThan(1400.0), () => {
                const h0 = f.swell.add(f.heads).add(0.15);
                const shade = float(1.0).toVar();
                for (const t of taps) {
                    const qt = q.sub(vec2(0.0, t));
                    const mT = f.m.sub(f.gradM.y.mul(t));
                    // Near taps carry the big heaps along their slope (a heap is 64 units across);
                    // the farthest tap leaves out the small heads (a typical head's height
                    // instead). Five field reads instead of eight on the four-tap tiers.
                    const heapT = t <= 12
                        ? max(f.hp.x.sub(f.hp.z.mul(t / F.heapCell)), 0.0)
                        : nvDomesH(qt.div(F.heapCell).add(vec2(-21.7, 0.0)), period(F.heapCell));
                    const headT = t <= 30 ? nvDomesH(qt.div(F.headCell), period(F.headCell)) : float(0.35);
                    const piledT = heapT.mul(F.heapH).add(headT.mul(F.headH));
                    const ht = f.swell.sub(f.gradSwell.y.mul(t)).add(piledT.mul(mT));
                    const pen = 0.3 + t * 0.07;
                    const clear = h0.add(t * SUN_TAN).sub(ht);
                    shade.assign(min(shade, smoothstep(-pen, pen, clear)));
                }
                shadow.assign(mix(shade, float(1.0), smoothstep(700.0, 1400.0, dist)));
            });
        }

        // ── The towers' long shadows: a ray from here toward the sun reaches the tower's plane
        // (its z) at height h + s·tan(el); inside the tower's width there, below its crown, it is
        // blocked. Soft by the sun's size and the cloud's ragged edge. ──
        const towerLit = float(1.0).toVar();
        towers.forEach((t) => {
            const s = p.z.sub(t.z);
            const yr = height.sub(F.offset).add(s.mul(SUN_TAN));
            const yn = clamp(yr.div(t.h), 0.0, 1.2);
            // towerHalfWidth() (nimbus-veil-tsl.js) in TSL: a tapering body and a round crown.
            const crownT = clamp(yn.sub(0.78).div(0.32), 0.0, 1.0);
            const hw = float(t.h).mul(float(0.37).sub(yn.mul(0.07)))
                .mul(sqrt(max(float(1.0).sub(crownT.mul(crownT)), 0.0)));
            const pen = s.mul(0.03).add(8.0);
            const across = float(1.0).sub(smoothstep(hw.sub(pen), hw.add(pen), abs(p.x.sub(t.x))));
            const below = float(1.0).sub(smoothstep(t.h * 1.04 - 6, t.h * 1.1, yr));
            const behind = smoothstep(t.h * -0.15, 0.0, s);
            towerLit.mulAssign(float(1.0).sub(across.mul(below).mul(behind).mul(0.85)));
        });
        const lit = shadow.mul(towerLit).toVar();

        // ── Light ──
        const ndl = dot(n, L);
        // The sun is low: a flat crown gets a grazing 0.17; faces toward it blaze, faces away
        // fall into the violet shade.
        const diff = clamp(ndl.mul(1.15).add(0.16), 0.0, 1.0).toVar();
        const sunCol = rgb(0xffc48c, 1.85);
        // Sky light: lavender-blue from the zenith on the crowns, rose from the horizon on the
        // flanks; creases see less of the sky.
        const sky = mix(rgb(0xa37fb0, 0.3), rgb(0x8186d0, 0.44), n.y.mul(0.5).add(0.5));
        const creaseDark = mix(float(0.5), float(0.85), smoothstep(150.0, 700.0, dist));
        const ao = mix(creaseDark, float(1.0), smoothstep(0.0, 0.55, f.hd.x))
            .mul(mix(float(0.85), float(1.0), smoothstep(0.0, 0.5, cauli)));
        // Cloud tops scatter: even a crown the sun barely grazes is bright, so the sun's light
        // has a floor under the slope term — and the shadows (heads, tower lanes) read against it.
        const col = sunCol.mul(diff.mul(0.7).add(0.3).mul(lit).mul(0.85)).add(sky.mul(ao).mul(0.85)).toVar();
        // Light leaks through the cloud: a lit crown's shade side still glows a little.
        col.addAssign(sunCol.mul(0.07).mul(crown).mul(lit));

        // ── Forward scattering, looking toward the sun: the heads' grazing edges glow (the silver
        // lining), and the far deck under the sun turns into a glare path ──
        const cosVL = max(dot(V, L), 0.0);
        const c2 = cosVL.mul(cosVL);
        const c4 = c2.mul(c2);
        const c8 = c4.mul(c4);
        const c16 = c8.mul(c8);
        const lobe = c16.mul(0.5).add(c16.mul(c16).mul(c16).mul(1.5)).toVar();
        const facing = clamp(dot(n, V.negate()), 0.0, 1.0);
        const g = float(1.0).sub(facing);
        const rim = g.mul(g).mul(g);
        col.addAssign(sunCol.mul(lobe).mul(rim.mul(1.5).add(0.1)).mul(mix(lit, float(1.0), 0.2))
            .mul(u.sunPulse.mul(0.5).add(1.0)));
        // As play heats the glare path turns molten: deep amber down the sun's bearing, on the
        // lit faces, the shadows left dark.
        col.addAssign(rgb(0xff8a3a, 1.5).mul(lobe).mul(rim.add(0.3)).mul(mix(float(0.25), float(1.0), lit))
            .mul(u.blaze.z));

        // ── Light waves (line clears / level up) rolling in over the heads toward the camera,
        // brightest on the crowns; a hot wave burns amber ──
        const ring = ringLight(u.rings, dist, 1, 0.7, 0.4);
        const ringCol = mix(rgb(0xffd9a0, 2.2), rgb(0xff8644, 2.0), ring.heat);
        // A hot band leaves the shadows darker: it reads as a line of fire on the crowns.
        col.addAssign(ringCol.mul(ring.sum.mul(mix(float(0.45), float(1.0), crown))
            .mul(mix(float(0.6).sub(ring.heat.mul(0.35)), float(1.0), lit))));

        // ── Mist pooled in the creases: violet, warm toward the sun ──
        const mist = mix(rgb(0xb8a6d8, 0.62), rgb(0xffd2b0, 0.95), clamp(lobe.mul(2.0), 0.0, 1.0));
        col.assign(mix(col, mist, float(1.0).sub(smoothstep(0.0, 0.3, f.hd.x)).mul(0.4)));
        // Event glow: the whole sea warms a little on combos.
        col.mulAssign(float(1.0).add(u.seaGlow.mul(0.18)));

        return nvApplyHaze(col, rel, float(SEA_HAZE), u.sunPulse);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusCloudSea';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
}
