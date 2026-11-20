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
    Loop,
    abs,
    cameraPosition,
    clamp,
    dot,
    exp,
    float,
    fwidth,
    int,
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
    TOWERS,
    nvApplyHaze,
    nvDomes,
    nvDomesH,
    nvNoise2,
    nvNoisedP,
    nvSpectrum,
    rgb,
} from './nimbus-veil-tsl.js';

/** Ripples on the deck that can spread at once (a lock a ripple). */
export const RIPPLE_SLOTS = 4;

/**
 * A chain's stepping stones: bars of light on the deck along the sun's bearing, one more for
 * each clear, each nearer the lens than the last (their distances from the rest camera). The
 * distances are chosen so the stones stand at even steps down the SCREEN (2.2 degrees apart,
 * from 3.6 degrees under the horizon): a stair of light from the sun to the eye. The sun's bearing
 * is where the layout parks the sun, so the stair always lies in the open stage.
 */
export const ROAD_STONES = Object.freeze([381, 236, 171, 133, 109, 92, 80, 70]);
/**
 * A stone's half-size at distance D, across the bearing and along it: the same size on screen
 * near or far (a fixed angle across; along, a fixed angle as the grazing eye sees the deck).
 */
export const stoneSize = (distance) => ({ across: distance * 0.096, along: distance * distance * 0.00042 });

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
 * light. `wide` widens the bands (the towers take them three times as wide). `fringe` is the
 * shade that lies either side of a band's core (|d|·e^(−d²): nothing at the core, most at its
 * shoulders): on a deck as bright as the band itself, the fringe is what makes it a line.
 */
export function ringLight(rings, dist, wide = 1, knee = 0.8, room = 0.6) {
    const sum = float(0.0).toVar();
    const hot = float(0.0).toVar();
    const fringe = float(0.0).toVar();
    rings.forEach((P) => {
        const d = dist.sub(P.x).mul(P.y).div(wide).toVar();
        const r = exp(d.mul(d).mul(0.5).negate()).mul(P.z).toVar();
        const core = r.mul(exp(d.mul(d).mul(0.5).negate()));
        sum.addAssign(core);
        hot.addAssign(core.mul(P.w));
        fringe.addAssign(abs(d).mul(r));
    });
    const heat = clamp(hot.div(max(sum, 1e-4)), 0.0, 1.0);
    // Bands that overlap add up to a soft limit: one wave reads as it always has, a procession
    // never floods the deck or a tower with light (linear to `knee`, then easing to knee + room).
    const over = max(sum.sub(knee), 0.0);
    const light = min(sum, knee).add(over.div(over.div(room).add(1.0)));
    return { sum: light, heat, fringe };
}

/**
 * Swell, mask and heads at field point q (world units, scrolled): their values and gradients.
 * `pile` is how high the air lets the heads stand (u.air.w: 1 on a plain day, less toward stratus).
 */
function baseField(q, pile) {
    const sw = nvNoisedP(q.div(F.swellCell), period(F.swellCell)).toVar();
    const mk = nvNoisedP(q.div(F.maskCell).add(vec2(31.7, 0.0)), period(F.maskCell)).toVar();
    const hp = nvDomes(q.div(F.heapCell).add(vec2(-21.7, 0.0)), period(F.heapCell)).toVar();
    const hd = nvDomes(q.div(F.headCell), period(F.headCell)).toVar();
    // The mask: heads tower where it is high and flatten toward stratus where it is low.
    // m = 0.15 + 1.1·smoothstep(0.2, 0.85, mask), and its slope by the chain rule.
    const ms = clamp(mk.x.sub(0.2).div(0.65), 0.0, 1.0);
    const m = ms.mul(ms).mul(float(3.0).sub(ms.mul(2.0))).mul(1.1)
        .add(0.15)
        .mul(pile)
        .toVar();
    const gradM = mk.yz.mul(ms.mul(float(1.0).sub(ms)).mul((6.0 * 1.1) / (0.65 * F.maskCell))).mul(pile);
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
 * @param {boolean} [opts.shade]        the high cloud's shade drifting over the deck
 * @param {number} [opts.towers=0]      how many towers (prefix of TOWERS) throw shadows
 */
export function createCloudSea(u, opts = {}) {
    const geometry = buildSeaGeometry(opts.rings ?? 180, opts.segments ?? 180);
    const taps = opts.shadowTaps ?? SEA_SHADOW_TAPS.four;
    const withCauli = opts.cauliflower !== false;
    const withFine = opts.fine !== false;
    const withShade = opts.shade !== false;
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
        const f = baseField(q, u.air.w);
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

        const f = baseField(q, u.air.w);
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
        const L = u.sunDir;

        // ── Self-shadow: the ray toward the sun climbs u.sunTan per unit; a higher head on its
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
                    const clear = h0.add(u.sunTan.mul(t)).sub(ht);
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
            const yr = height.sub(F.offset).add(s.mul(u.sunTan));
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
        // ── The high cloud's shade: when the ceiling is broken (u.air2.x) its shadows drift over
        // the deck on the wind, fields of dimmer cloud with the sun still on the heads between. ──
        const ceilLit = float(1.0).toVar();
        if (withShade) {
            If(u.air2.x.greaterThan(0.02), () => {
                const sp = vec2(p.x, p.z).mul(0.0042).add(vec2(u.ceilFlow.x.mul(9.0), u.ceilFlow.y.mul(9.0).add(4.4)));
                const cover = nvNoise2(sp).mul(0.66).add(nvNoise2(sp.mul(2.3).add(vec2(11.3, 5.9))).mul(0.34));
                ceilLit.assign(float(1.0).sub(smoothstep(0.42, 0.7, cover).mul(u.air2.x).mul(0.52)));
            });
        }
        // What of the sun reaches this point: none of it once the sun stands under the sea line.
        const lit = shadow.mul(towerLit).mul(ceilLit).mul(u.day).toVar();

        // ── Light ──
        const ndl = dot(n, L);
        // The sun is low: a flat crown gets a grazing 0.17; faces toward it blaze, faces away
        // fall into the violet shade.
        const diff = clamp(ndl.mul(1.15).add(0.16), 0.0, 1.0).toVar();
        // The key light and the sky's fill are the mood's (gold and lavender in today's).
        const sunCol = u.mood.sunLight;
        // Sky light: lavender-blue from the zenith on the crowns, rose from the horizon on the
        // flanks; creases see less of the sky.
        const sky = mix(u.mood.skyLow, u.mood.skyHigh, n.y.mul(0.5).add(0.5));
        const creaseDark = mix(float(0.42), float(0.85), smoothstep(110.0, 700.0, dist));
        const ao = mix(creaseDark, float(1.0), smoothstep(0.0, 0.55, f.hd.x))
            .mul(mix(float(0.76), float(1.0), smoothstep(0.0, 0.5, cauli)));
        // Once the sun is under the sea line the whole sky is the lamp: its fill rises, and the
        // faces that look toward the afterglow take a little of its colour.
        const gloam = float(1.0).sub(u.day).toVar();
        const fill = sky.mul(ao).mul(gloam.mul(1.5).add(0.85))
            .add(u.mood.glowWide.mul(clamp(n.z.negate().mul(0.6).add(0.4), 0.0, 1.0)).mul(gloam).mul(ao).mul(0.32));
        // Cloud tops scatter: even a crown the sun barely grazes is bright, so the sun's light
        // has a floor under the slope term — and the shadows (heads, tower lanes) read against it.
        const col = sunCol.mul(diff.mul(0.7).add(0.3).mul(lit).mul(0.85)).add(fill).toVar();
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
        col.addAssign(sunCol.mul(lobe).mul(rim.mul(1.5).add(0.1)).mul(mix(lit, u.day, 0.2))
            .mul(u.sunPulse.mul(0.5).add(1.0)));
        // And a wider, softer lining: every head between the eye and the sun wears a thin rim
        // of light on the edge it turns away, far beyond the glare path.
        col.addAssign(sunCol.mul(c4.mul(rim).mul(0.42)).mul(lit));
        // As play heats the glare path turns molten: deep amber down the sun's bearing, on the
        // lit faces, the shadows left dark.
        col.addAssign(rgb(0xff8a3a, 1.5).mul(lobe).mul(rim.add(0.3)).mul(mix(float(0.25), float(1.0), lit))
            .mul(u.blaze.z)
            .mul(u.day.mul(0.75).add(0.25)));

        // ── Light waves (line clears / level up) rolling in over the heads toward the camera,
        // brightest on the crowns; a hot wave burns amber ──
        const ring = ringLight(u.rings, dist, 1, 0.7, 0.4);
        // (u.lampInfo.z: event light is as bright as the hour lets it be; the night's is dimmer.)
        const ringCol = mix(rgb(0xffcf80, 2.6), rgb(0xff8644, 2.3), ring.heat).mul(u.lampInfo.z);
        // The shade at a band's shoulders (on the sunlit deck a band is no brighter than the deck).
        col.mulAssign(float(1.0).sub(min(ring.fringe, 1.0).mul(0.36).mul(u.day.mul(0.6).add(0.4))));
        // A hot band leaves the shadows darker: it reads as a line of fire on the crowns.
        // The waves are light of their own: they cross a deck in shade as brightly as a lit one.
        const waveLit = mix(shadow.mul(towerLit), float(1.0), gloam);
        col.addAssign(ringCol.mul(ring.sum.mul(mix(float(0.45), float(1.0), crown))
            .mul(mix(float(0.6).sub(ring.heat.mul(0.35)), float(1.0), waveLit))));

        // ── A perfect clear's wave carries the spectrum: red on its leading edge, violet behind ──
        const { glory } = u;
        const across = dist.sub(glory.x).mul(glory.y).toVar();
        col.addAssign(nvSpectrum(clamp(float(0.5).sub(across.mul(0.36)), 0.0, 1.0)).mul(0.9).add(0.25)
            .mul(exp(across.mul(across).negate()).mul(glory.z).mul(mix(float(0.55), float(1.0), crown)).mul(1.35))
            .mul(u.lampInfo.z));

        // ── A chain's stepping stones (u.road: x how many are lit, y on/off): a stair of bars
        // of light down the sun's bearing, the newest the nearest. Each has a core of light and
        // a rim of shade, as the waves have, so it reads on the sunlit deck too. ──
        If(u.road.y.greaterThan(0.003), () => {
            const aside = p.x.sub(RIG.x).toVar();
            const toward = float(RIG.z).sub(p.z).toVar();
            const stones = float(0.0).toVar();
            const rims = float(0.0).toVar();
            ROAD_STONES.forEach((distance, k) => {
                const size = stoneSize(distance);
                const ex = aside.div(size.across);
                const ez = toward.sub(distance).div(size.along);
                const d2 = ex.mul(ex).add(ez.mul(ez)).toVar();
                const wide = exp(d2.mul(-0.5)).mul(clamp(u.road.x.sub(k), 0.0, 1.0)).toVar();
                stones.addAssign(wide.mul(exp(d2.mul(-0.5))));
                rims.addAssign(sqrt(d2).mul(wide));
            });
            col.mulAssign(float(1.0).sub(min(rims, 1.0).mul(0.7).mul(u.day.mul(0.6).add(0.4))));
            col.addAssign(u.lampTint.mul(min(stones, 1.4).mul(mix(float(0.65), float(1.0), crown)).mul(3.8))
                .mul(u.lampInfo.z));
        });

        // ── A lock's ripple: a ring of light spreading on the deck beside the board ──
        const ripple = float(0.0).toVar();
        const trough = float(0.0).toVar();
        Loop({
            start: int(0), end: int(RIPPLE_SLOTS), type: 'int', condition: '<',
        }, ({ i }) => {
            const slot = u.ripples.element(i);
            const from = length(vec2(p.x, p.z).sub(slot.xy)).toVar();
            const off = from.sub(slot.z);
            const wide = slot.z.mul(0.2).add(1.6);
            // The crest, a soft light inside it that it leaves behind, and the trough that
            // runs ahead of it: on a deck this bright a ripple reads by its shade as much.
            ripple.addAssign(exp(off.mul(off).div(wide.mul(wide)).negate())
                .add(float(1.0).sub(smoothstep(0.0, slot.z, from)).mul(0.2)).mul(slot.w));
            const ahead = off.sub(wide.mul(1.9));
            trough.addAssign(exp(ahead.mul(ahead).div(wide.mul(wide)).negate()).mul(slot.w));
        });
        col.mulAssign(float(1.0).sub(min(trough, 1.0).mul(0.5)));
        col.addAssign(u.lampTint.mul(min(ripple, 1.6).mul(mix(float(0.6), float(1.0), crown)).mul(3.0))
            .mul(u.lampInfo.z));

        // ── Mist pooled in the creases: violet, warm toward the sun ──
        const mist = mix(u.mood.mistA, u.mood.mistT, clamp(lobe.mul(2.0), 0.0, 1.0));
        col.assign(mix(col, mist, float(1.0).sub(smoothstep(0.0, 0.3, f.hd.x)).mul(0.4)));
        // Event glow: the whole sea warms a little on combos.
        col.mulAssign(float(1.0).add(u.seaGlow.mul(0.18)));

        return nvApplyHaze(u, col, rel, float(SEA_HAZE), u.sunPulse);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'NimbusCloudSea';
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    return mesh;
}
