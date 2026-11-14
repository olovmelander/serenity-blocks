/**
 * High Coast — the sea.
 *
 * One fan of rings round the eye's foot, out to the horizon, standing at the sea's level (which
 * falls as the land rises) and dropping with the earth's curvature like the land. The fragment
 * builds the water's slope from wind ripples (trains and the noise), keeps count of the slope a
 * pixel can no longer resolve (the variance: what turns the sun's image into a road of glitter
 * that widens toward the horizon), and then:
 *
 *  - mirrors the sky and its cloud deck, and the islands: a short march of the mirror ray over the
 *    heightfield finds the land it meets (forest crowns included) and lights it coarsely;
 *  - looks down into the Baltic: brown-green over the rock of the shallows, dark blue-black deep;
 *  - draws the waterline: a thin wash of foam along every shore, which moves when the land rises
 *    and runs white for a while after it does;
 *  - carries gameplay on the water: gusts (cat's paws) racing out from beside the card, the swell
 *    a released chain sends in from the open sea, and the glass calm of a perfect clear with the
 *    breeze returning from the horizon.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    Loop,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    step,
    texture,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { EARTH_DROP, EYE, TIMING } from './high-coast-core.js';
import {
    GUSTS, RINGS, fieldScalar, fieldWeights, hcHash22, hcLuma, heightAt, landAt,
} from './high-coast-tsl.js';
import {
    CLOUD_BASE, aerial, cloudShadow, skyColour, sunGlow,
} from './high-coast-light.js';
import { shadowAt } from './high-coast-shadow.js';

/** The fan of rings: nearest and farthest ring (metres), half-width (degrees). */
export const SEA_FAN = Object.freeze({ near: 6, far: 62000, halfAngle: 50 });

/**
 * Wind ripples as trains: (direction x, direction z, wavenumber 1/m, angular speed rad/s,
 * slope amplitude). The clock only ever multiplies a constant (a gust changes amplitude).
 */
const RIPPLES = Object.freeze([
    [0.92, -0.39, 0.55, 2.3, 0.05],
    [0.71, 0.7, 0.9, 2.95, 0.04],
    [-0.31, -0.95, 1.6, 3.95, 0.035],
    [0.98, 0.2, 2.7, 5.15, 0.03],
    [0.45, -0.89, 4.4, 6.55, 0.024],
]);
/** Slope variance a pixel too coarse for any ripple still carries (calm water's floor). */
const GLINT_FLOOR = 0.0006;
/** A glint's cell in pixels (the cells are laid out in the angles the resting eye sees). */
const GLINT_PIXELS = 3.4;
/** Absorption of the Baltic per metre (red, green, blue): brown-green, blue goes first. */
const ABSORB = [0.3, 0.075, 0.13];

/** The fan of rings round the eye's foot (positions, a normal that faces up, the indices). */
export function buildSeaFan(rings, spokes) {
    const half = SEA_FAN.halfAngle * (Math.PI / 180);
    const positions = new Float32Array(rings * spokes * 3);
    const lnNear = Math.log(SEA_FAN.near);
    const lnFar = Math.log(SEA_FAN.far);
    for (let i = 0; i < rings; i += 1) {
        const r = Math.exp(lnNear + (lnFar - lnNear) * (i / (rings - 1)));
        for (let j = 0; j < spokes; j += 1) {
            const a = -half + (2 * half * j) / (spokes - 1);
            const at = (i * spokes + j) * 3;
            positions[at] = EYE.x + r * Math.sin(a);
            positions[at + 1] = 0;
            positions[at + 2] = EYE.z - r * Math.cos(a);
        }
    }
    const indices = new Uint32Array((rings - 1) * (spokes - 1) * 6);
    let k = 0;
    for (let i = 0; i < rings - 1; i += 1) {
        for (let j = 0; j < spokes - 1; j += 1) {
            const a = i * spokes + j;
            const b = a + spokes;
            indices[k++] = a;
            indices[k++] = a + 1;
            indices[k++] = b;
            indices[k++] = a + 1;
            indices[k++] = b + 1;
            indices[k++] = b;
        }
    }
    return { positions, indices };
}

/** The share of facets that mirror the light L toward the eye V (Sunset's road of light). */
export const glintLobe = /* @__PURE__ */ Fn(([slope, variance, V, L]) => {
    const H = normalize(L.add(V)).toVar();
    const want = H.xz.negate().div(max(H.y, 0.08));
    const miss = want.sub(slope);
    const s2 = max(variance, GLINT_FLOOR);
    const share = exp(dot(miss, miss).div(s2.mul(-2.0))).div(s2.mul(6.2832));
    const h2 = H.y.max(0.35).mul(H.y.max(0.35));
    const geometry = float(1.0).div(max(V.y, 0.045).mul(4.0).mul(h2.mul(h2)));
    const cosine = clamp(dot(V, H), 0.0, 1.0);
    const m = float(1.0).sub(cosine);
    const m2 = m.mul(m);
    const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98));
    return share.mul(geometry).mul(fresnel);
}).setLayout({
    name: 'hc_glintLobe',
    type: 'float',
    inputs: [
        { name: 'slope', type: 'vec2' }, { name: 'variance', type: 'float' }, { name: 'V', type: 'vec3' },
        { name: 'L', type: 'vec3' },
    ],
});

/** The cloud deck's cover where a ray from P along dir meets it (0 where it never does). */
export function deckAlong(u, noise, P, dir) {
    const up = max(dir.y, 0.02);
    const at = P.xz.add(dir.xz.mul(float(CLOUD_BASE).sub(P.y).div(up))).add(u.wind);
    const a = texture(noise, at.div(14000.0)).r;
    const b = texture(noise, at.div(5200.0).add(vec2(0.37, 0.61))).g;
    const cover = a.mul(0.65).add(b.mul(0.35));
    const lo = float(1.0).sub(u.cloudCover);
    return smoothstep(lo, lo.add(0.22), cover).mul(smoothstep(0.02, 0.12, dir.y));
}

/**
 * @param {object} u     shared uniforms
 * @param {object} t     textures: fields, cover, shadow, noise
 * @param {object} tier  quality tier (seaRings, seaSpokes, ripples 1..5, mirrorSteps)
 */
export function createSea(u, t, tier) {
    const fan = buildSeaFan(tier.seaRings, tier.seaSpokes);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fan.positions, 3));
    const normals = new Float32Array(fan.positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(fan.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(EYE.x, 0, EYE.z), SEA_FAN.far);

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide, fog: false });
    material.name = 'HighCoastSea';

    // The water stands at the sea's level and falls away with the earth's curvature.
    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const d = length(p.xz.sub(vec2(EYE.x, EYE.z)));
        return vec3(p.x, u.sea.sub(d.mul(d).mul(EARTH_DROP)), p.z);
    })();

    const rippleCount = Math.min(RIPPLES.length, Math.max(1, tier.ripples));
    const { mirrorSteps } = tier;

    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const toEye = u.eye.sub(P);
        const dist = max(length(toEye), 1e-3).toVar();
        const V = toEye.div(dist).toVar();
        const grazing = max(V.y, 0.012);
        // A pixel's footprint along the view (metres): what the slope can still be resolved at.
        const foot = dist.mul(u.pixelAngle).div(grazing).toVar();
        const xz = P.xz.toVar();
        const { time } = u;

        // ── Where the wind is: patches of breeze and calm drifting over the bay, sheltered water
        // in the lee of the shores, the gusts gameplay sends, the calm of a perfect clear ──
        const here = fieldWeights(xz);
        const ground = landAt(t.fields, xz, here).toVar();
        const depth = u.sea.sub(ground.x).toVar();
        const drift = vec2(time.mul(1.1), time.mul(-0.7));
        const patchA = texture(t.noise, xz.add(drift.mul(12.0)).div(2600.0)).r;
        const patchB = texture(t.noise, xz.sub(drift.mul(7.0)).div(900.0).add(vec2(0.3, 0.6))).g;
        const breeze = smoothstep(0.32, 0.68, patchA.mul(0.6).add(patchB.mul(0.4))).mul(0.75).add(0.3).toVar();
        // The wind lies on the bay in lanes: long streaks of ruffled water with slicks between
        // them, drawn out along the wind (a read stretched eight to one), kilometres long far out
        // and a few hundred metres across in the near bay. A slick mirrors the pale horizon; the
        // breeze beside it is darker and bluer: the sea is never one flat colour.
        const laneAlong = dot(xz, vec2(0.92, -0.39)).add(time.mul(6.0));
        const laneAcross = dot(xz, vec2(0.39, 0.92));
        const lanes = texture(t.noise, vec2(laneAlong.div(11000.0), laneAcross.div(1500.0))).r.mul(0.6)
            .add(texture(t.noise, vec2(laneAlong.div(46000.0), laneAcross.div(6200.0)).add(vec2(0.43, 0.17))).g.mul(0.4));
        breeze.mulAssign(smoothstep(0.34, 0.6, lanes).add(0.16));
        breeze.mulAssign(smoothstep(0.0, 9.0, depth).mul(0.55).add(0.45));
        breeze.mulAssign(u.breeze);
        const gust = float(0.0).toVar();
        const gustTint = vec3(0.0).toVar();
        // One loop in the shader (not unrolled: eight copies of this would double the stage).
        Loop({
            start: int(0), end: int(GUSTS), type: 'int', condition: '<', name: 'gi',
        }, ({ gi }) => {
            const a = u.gusts.element(gi.mul(3));
            const b = u.gusts.element(gi.mul(3).add(1));
            const c = u.gusts.element(gi.mul(3).add(2));
            const age = time.sub(a.z);
            If(a.w.greaterThan(0.001).and(age.greaterThan(0.0)).and(age.lessThan(TIMING.gust + 0.5)), () => {
                const centre = a.xy.add(b.xy.mul(b.z.mul(age)));
                const off = xz.sub(centre);
                const along = dot(off, b.xy);
                const across = dot(off, vec2(b.y.negate(), b.x));
                // The patch grows as it runs, leaning back along its track.
                const w = b.w.mul(age.mul(0.35).add(0.6));
                const shape = exp(along.div(w.mul(1.7)).mul(along.div(w.mul(1.7))).add(across.div(w).mul(across.div(w))).negate());
                const envelope = smoothstep(0.0, 0.35, age).mul(float(1.0).sub(smoothstep(TIMING.gust * 0.45, TIMING.gust, age)));
                // Its crinkle: the ruffle is lumpy, not an ellipse.
                const lump = texture(t.noise, off.div(w.mul(0.9)).add(a.xy.mul(0.001))).level(0).b.mul(0.8).add(0.5);
                const g1 = shape.mul(envelope).mul(a.w).mul(lump);
                gust.addAssign(g1);
                // Its light: glitter in the piece's colour where it sets out, sun-white as it runs
                // (in hot play it keeps `c.w` of its colour all the way).
                const young = max(float(1.0).sub(smoothstep(0.2, TIMING.gust * 0.7, age)), c.w);
                gustTint.addAssign(mix(vec3(1.0, 0.92, 0.75), c.xyz.mul(2.2).add(0.15), young).mul(g1));
            });
        });
        // ── Rings and whirls: a lock's ring, a hard drop's pair with white water on the lead crest,
        // a twist's whirl of spiral arms. Each row gives the water a slope of its own (the mirror
        // bends over the crests), a thread of light along its crests and a share of glints. ──
        const ringSlope = vec2(0.0).toVar();
        const crestLight = float(0.0).toVar();
        const fxWeight = float(0.0).toVar();
        const whiteWater = float(0.0).toVar();
        Loop({
            start: int(0), end: int(RINGS), type: 'int', condition: '<', name: 'ri',
        }, ({ ri }) => {
            const a = u.rings.element(ri.mul(3));
            const b = u.rings.element(ri.mul(3).add(1));
            const c = u.rings.element(ri.mul(3).add(2));
            const age = time.sub(a.z).toVar();
            If(a.w.greaterThan(0.001).and(age.greaterThan(0.0)).and(age.lessThan(b.w)), () => {
                const off = xz.sub(a.xy).toVar();
                const r = max(length(off), 0.5).toVar();
                const outward = off.div(r).toVar();
                const k = age.div(b.w).toVar();
                const fresh = float(1.0).sub(k).toVar();
                If(b.z.lessThan(1.5), () => {
                    // A ring: a packet of three crests that slows and widens as it spreads. A
                    // splash (kind 1) sends a second, smaller packet after it.
                    const life = smoothstep(0.0, 0.06, k).mul(fresh).mul(fresh).mul(a.w)
                        .toVar();
                    const reach = b.x.mul(age).mul(float(1.0).sub(k.mul(0.38))).toVar();
                    const wide = b.y.mul(k.mul(1.3).add(0.55)).toVar();
                    const p1 = r.sub(reach).div(wide).toVar();
                    const p2 = r.sub(reach.mul(0.52)).div(wide.mul(0.8)).toVar();
                    const e1 = exp(p1.mul(p1).negate()).toVar();
                    const e2 = exp(p2.mul(p2).negate()).mul(b.z).mul(0.7).toVar();
                    ringSlope.addAssign(outward.mul(e1.mul(sin(p1.mul(3.0))).add(e2.mul(sin(p2.mul(3.0)))).mul(life).mul(0.2)));
                    const crest = e1.mul(cos(p1.mul(3.0)).mul(0.5).add(0.5)).add(e2.mul(cos(p2.mul(3.0)).mul(0.5).add(0.5)))
                        .mul(life).toVar();
                    crestLight.addAssign(crest);
                    fxWeight.addAssign(crest);
                    gustTint.addAssign(c.xyz.mul(crest));
                    whiteWater.addAssign(e1.mul(smoothstep(0.2, 0.9, cos(p1.mul(3.0)))).mul(life).mul(b.z).mul(0.7));
                }).Else(() => {
                    // A whirl: three arms of ruffled water winding in toward a still eye, turning.
                    const life = smoothstep(0.0, 0.12, k).mul(float(1.0).sub(smoothstep(0.55, 1.0, k))).mul(a.w).toVar();
                    const span = r.div(b.y.mul(smoothstep(0.0, 0.3, k).mul(0.45).add(0.55))).toVar();
                    const body = exp(span.mul(span).negate()).mul(float(1.0).sub(exp(span.mul(span).mul(-40.0)))).toVar();
                    const wind = atan(off.y, off.x).mul(3.0).add(log(r).mul(7.5)).sub(age.mul(b.x))
                        .toVar();
                    const arm = smoothstep(0.35, 0.95, cos(wind).mul(0.5).add(0.5)).mul(body).mul(life).toVar();
                    ringSlope.addAssign(vec2(outward.y.negate(), outward.x).mul(sin(wind)).mul(body).mul(life)
                        .mul(0.16));
                    gust.addAssign(arm.mul(0.7));
                    crestLight.addAssign(arm.mul(1.3));
                    fxWeight.addAssign(arm);
                    gustTint.addAssign(c.xyz.mul(arm));
                });
            });
        });
        // The great rebound's wave: a swell running out from the bay, a thin line of white water
        // breaking on its lead crest, a second crest behind it, glints along both.
        If(u.wave.w.greaterThan(0.001), () => {
            const off = xz.sub(u.wave.xy).toVar();
            const r = max(length(off), 1.0).toVar();
            const p = r.sub(u.wave.z).div(u.wave.z.mul(0.13).add(18.0)).toVar();
            const e = exp(p.mul(p).negate()).mul(u.wave.w).toVar();
            ringSlope.addAssign(off.div(r).mul(e.mul(sin(p.mul(3.2))).mul(0.3)));
            const crest = e.mul(cos(p.mul(3.2)).mul(0.5).add(0.5)).toVar();
            const c2 = crest.mul(crest).toVar();
            crestLight.addAssign(c2.mul(0.8));
            fxWeight.addAssign(crest.mul(0.8));
            gustTint.addAssign(u.waveTint.mul(1.4).add(0.25).mul(crest.mul(0.8)));
            // The break: only the very top of the lead crest (p just ahead of the wave's centre).
            const lead = exp(p.sub(0.15).mul(p.sub(0.15)).mul(-22.0)).mul(u.wave.w);
            whiteWater.addAssign(lead.mul(0.95).add(c2.mul(c2).mul(0.25)));
        });
        // A perfect clear: glass, with the breeze line returning from the horizon.
        // (It spreads out from the middle of the bay behind the wave that announces it.)
        const fromBay = length(xz.sub(u.wave.xy));
        const glass = u.calm.mul(float(1.0).sub(smoothstep(u.calmFront.sub(400.0), u.calmFront, dist)))
            .mul(float(1.0).sub(smoothstep(u.calmReach.mul(0.8), u.calmReach, fromBay)))
            .toVar();
        const amp = breeze.add(gust.mul(3.4)).mul(float(1.0).sub(glass.mul(0.97))).toVar();
        // On the glass, fish rise: fine rings open here and there and are gone.
        If(glass.greaterThan(0.02), () => {
            const cellAt = xz.div(150.0);
            const id = floor(cellAt).add(512.0).toVar();
            const h = hcHash22(id).toVar();
            const centre = floor(cellAt).add(h.mul(0.6).add(0.2)).mul(150.0);
            const off = xz.sub(centre).toVar();
            const r = max(length(off), 0.3).toVar();
            // Each cell's fish rises once every 7 to 12 seconds; its ring lives four.
            const beat = fract(time.div(h.x.mul(5.0).add(7.0)).add(h.y)).mul(h.x.mul(5.0).add(7.0)).toVar();
            const p = r.sub(beat.mul(7.0)).div(beat.mul(0.9).add(1.6)).toVar();
            const e = exp(p.mul(p).negate()).mul(float(1.0).sub(smoothstep(1.5, 4.0, beat))).mul(smoothstep(0.0, 0.15, beat))
                .mul(glass)
                .mul(float(1.0).sub(smoothstep(1.2, 5.0, foot)))
                .toVar();
            ringSlope.addAssign(off.div(r).mul(e.mul(sin(p.mul(3.0))).mul(0.06)));
            // Glass still breathes: a long, low heave that bends every image a little and breaks
            // the sun's pillar into slivers of light, as on a real calm sea.
            const lull = texture(t.noise, xz.div(700.0)).r.mul(7.0);
            const heaveA = cos(dot(xz, vec2(0.22, 0.975)).mul(0.14).sub(time.mul(0.55)).add(lull));
            const heaveB = cos(dot(xz, vec2(-0.5, 0.866)).mul(0.33).sub(time.mul(0.9)).add(lull.mul(1.7)));
            ringSlope.addAssign(vec2(0.22, 0.975).mul(heaveA.mul(0.011)).add(vec2(-0.5, 0.866).mul(heaveB.mul(0.007))).mul(glass));
        });

        // ── The slope: ripple trains, then the noise; what a pixel cannot resolve is variance ──
        const slope = vec2(0.0).toVar();
        const variance = float(GLINT_FLOOR).toVar();
        // The trains' phase is warped by the noise so no crest runs on for long (coherent trains
        // draw a regular scale pattern).
        const warp = texture(t.noise, xz.div(41.0)).r.mul(9.0).add(texture(t.noise, xz.div(12.0).add(vec2(0.4, 0.1))).g.mul(3.5));
        for (let i = 0; i < rippleCount; i += 1) {
            const row = RIPPLES[i];
            const L = (2 * Math.PI) / row[2];
            const seen = float(1.0).sub(smoothstep(L * 0.12, L * 0.45, foot));
            const theta = dot(xz, vec2(row[0], row[1])).mul(row[2]).sub(time.mul(row[3])).add(warp.mul(1 + i * 0.35));
            const s = row[4] * 0.75;
            slope.addAssign(vec2(row[0], row[1]).mul(cos(theta).mul(s).mul(seen)));
            variance.addAssign(float(0.5 * s * s).mul(float(1.0).sub(seen)));
        }
        const tiles = [11.0, 3.4, 0.9];
        const drifts = [vec2(0.13, -0.21), vec2(-0.27, -0.36), vec2(0.5, -0.62)];
        for (let i = 0; i < Math.min(3, tier.rippleNoise); i += 1) {
            const tile = tiles[i];
            const at = xz.div(tile).add(drifts[i].mul(time)).add(vec2(i * 0.37, i * 0.71));
            const s = texture(t.noise, at).rg.sub(0.5).mul(0.15);
            const seen = float(1.0).sub(smoothstep(tile / 60, tile / 5, foot));
            slope.addAssign(s.mul(seen));
            variance.addAssign(float(0.0016).mul(float(1.0).sub(seen)));
        }
        // A released chain's swell: long crests running in from the open sea.
        If(u.swell.x.greaterThan(0.001), () => {
            const sw = dot(xz, vec2(-0.34, 0.94)).mul(0.11).sub(time.mul(1.25));
            const band = exp(dist.sub(u.swell.y).div(260.0).mul(dist.sub(u.swell.y).div(260.0)).negate());
            slope.addAssign(vec2(-0.34, 0.94).mul(cos(sw).mul(0.17).mul(u.swell.x).mul(band.mul(0.7).add(0.3))));
        });
        slope.mulAssign(amp);
        slope.addAssign(ringSlope);
        variance.assign(variance.mul(amp.mul(amp)).add(GLINT_FLOOR).add(gust.mul(0.0035)));

        const N = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
        // The ripples a pixel cannot resolve still tilt its facets: ruffled water turns more of them
        // up toward the higher, deeper sky and mirrors less of it, so the breeze lies on the bay as
        // darker, bluer water and the slicks between as pale lanes of the horizon's light.
        const rough = variance.sqrt().toVar();
        const cosV = clamp(dot(V, N).add(rough.mul(0.9)), 0.0, 1.0);
        const m = float(1.0).sub(cosV);
        const m2 = m.mul(m);
        const fresnel = float(0.02).add(m2.mul(m2).mul(m).mul(0.98)).toVar();
        // A perfect clear's glass holds the sky: the mirror takes over from the water's own colour.
        fresnel.assign(max(fresnel, glass.mul(0.72)));

        // ── What the sea mirrors: the sky and its deck, then the land the mirror ray meets ──
        const R0 = V.negate().reflect(N);
        const R = normalize(vec3(R0.x, max(R0.y, 0.003).add(rough.mul(1.6)), R0.z)).toVar();
        const sky = skyColour(u, R, { withSun: false }).toVar();
        const deck = deckAlong(u, t.noise, P, R);
        sky.assign(mix(sky, mix(u.cloudShade, u.cloudLit, 0.55).add(u.glow.mul(sunGlow(dot(R, u.sunDir)).mul(0.5))), deck.mul(0.8)));
        const mirrored = sky.toVar();
        // A gust's ruffle tilts the facets up to the zenith: the patch darkens and blues.
        mirrored.assign(mix(mirrored, u.zenith.mul(1.6).add(u.fill.mul(0.3)), gust.clamp(0.0, 1.0).mul(0.75)));
        if (mirrorSteps > 0) {
            // March out over the water, then refine: one loop whose first mirrorSteps iterations
            // step outward and whose remaining ones (after a hit) bisect between the last step
            // above the land (lo) and the first below it (hi). The ray's closest pass over the land
            // is kept as an angle: a ray that grazes a crown between two steps still takes some of
            // it, so the image's edge is soft, not stair-stepped. The land test is written once.
            const found = float(0.0).toVar();
            const lo = float(0.0).toVar();
            const hi = float(0.0).toVar();
            const gap = float(1.0).toVar();
            const nearT = float(0.0).toVar();
            const reach = 3200.0;
            const first = 3.0;
            const growth = (reach / first) ** (1 / mirrorSteps);
            const travel = float(first).toVar();
            Loop({
                start: int(0), end: int(mirrorSteps + 4), type: 'int', condition: '<', name: 'mi',
            }, ({ mi }) => {
                const marching = float(1.0).sub(found).toVar();
                If(marching.lessThan(0.5).or(mi.lessThan(int(mirrorSteps))), () => {
                    const s = mix(lo.add(hi).mul(0.5), travel, marching).toVar();
                    const q = P.add(R.mul(s)).toVar();
                    const there = fieldWeights(q.xz);
                    const a = q.y.sub(heightAt(t.fields, q.xz, there).add(fieldScalar(t.cover, q.xz, 0.0, there).mul(15.0))).toVar();
                    If(marching.greaterThan(0.5), () => {
                        If(a.lessThan(0.0), () => {
                            found.assign(1.0);
                            hi.assign(s);
                        }).Else(() => {
                            lo.assign(s);
                            If(a.div(s).lessThan(gap), () => {
                                gap.assign(a.div(s));
                                nearT.assign(s);
                            });
                        });
                        travel.mulAssign(growth);
                    }).Else(() => {
                        If(a.lessThan(0.0), () => {
                            hi.assign(s);
                        }).Else(() => {
                            lo.assign(s);
                        });
                    });
                });
            });
            const cover = found.max(float(1.0).sub(smoothstep(0.0, 0.01, gap))).toVar();
            If(cover.greaterThan(0.004), () => {
                const at = found.greaterThan(0.5).select(hi, nearT).toVar();
                const q = P.add(R.mul(at)).toVar();
                const met = fieldWeights(q.xz);
                const land = landAt(t.fields, q.xz, met);
                const forest = fieldScalar(t.cover, q.xz, 0.0, met);
                const n = normalize(vec3(land.y.negate(), 1.0, land.z.negate()));
                const rock = mix(vec3(0.3, 0.17, 0.12), vec3(0.28, 0.27, 0.25), smoothstep(0.6, 1.4, length(land.yz)).oneMinus().mul(0.4));
                const albedo = mix(rock, vec3(0.03, 0.055, 0.03), smoothstep(0.15, 0.55, forest));
                const sunLit = u.sun.mul(clamp(dot(n, u.sunDir), 0.0, 1.0)).mul(shadowAt(t.shadow, q.xz, met)).mul(u.sunUp);
                const lit = albedo.mul(sunLit.add(u.fill.mul(land.w.mul(0.7).add(0.3))).add(u.bounce.mul(0.4)));
                // Only the air between the water and the land: the water's own aerial adds the rest.
                const tau = u.hazeDensity.mul(1.0 / 16000).add(u.mistDensity.mul(1.0 / 700)).mul(at);
                const seen = mix(sky, lit, exp(tau.negate()));
                // A ripple smears the image a little toward the sky it stands in.
                const keep = float(1.0).sub(smoothstep(0.004, 0.03, variance).mul(0.35));
                mirrored.assign(mix(mirrored, seen, keep.mul(cover)));
            });
        }

        // ── Down into the water: the rock of the shallows through brown-green Baltic water ──
        const clouds = cloudShadow(u, t.noise, P);
        const shade = shadowAt(t.shadow, xz, here).mul(clouds);
        const light = u.sun.mul(max(u.sunDir.y, 0.0).mul(0.6).add(0.15)).mul(shade).mul(u.sunUp).add(u.fill.mul(1.4));
        const path = max(depth, 0.0).mul(float(1.0).add(float(1.0).div(max(V.y, 0.08)).mul(0.5)));
        const trans = exp(vec3(ABSORB[0], ABSORB[1], ABSORB[2]).mul(path).negate()).toVar();
        const bottom = mix(vec3(0.2, 0.15, 0.1), vec3(0.3, 0.27, 0.2), texture(t.noise, xz.div(7.0)).a).mul(light);
        // The deep: scattered light the colour of the hour's water, brighter toward the sun.
        const forward = clamp(dot(V.negate(), normalize(vec3(u.sunDir.x, 0.0, u.sunDir.z))), 0.0, 1.0);
        const deep = u.water.mul(float(1.0).add(forward.mul(forward).mul(1.6))).mul(u.day.mul(0.7).add(0.3)).add(u.fill.mul(0.04));
        const body = bottom.mul(trans).add(deep.mul(vec3(1.0).sub(trans))).toVar();

        // On the glass a sheen of mother-of-pearl drifts through the mirrored sky.
        If(glass.greaterThan(0.02), () => {
            const sheen = texture(t.noise, xz.div(2400.0).add(vec2(time.mul(0.006), 0.0))).r.mul(2.2).add(dist.div(4200.0));
            const pearl = cos(vec3(0.0, 2.1, 4.2).add(sheen.mul(6.2832))).mul(0.5).add(0.5);
            mirrored.mulAssign(pearl.sub(0.5).mul(glass).mul(0.22).add(1.0));
        });
        const water = body.mul(float(1.0).sub(fresnel)).add(mirrored.mul(fresnel)).toVar();

        // ── The sun's road ──
        const lobe = glintLobe(slope, variance, V, u.sunDir).mul(u.sunUp).mul(clouds);
        // (Its core rolls off: a calm sea's image of the sun stays a shape, not a slab of white.)
        const road = lobe.div(lobe.mul(0.05).add(1.0));
        water.addAssign(u.sun.mul(road).mul(0.55));
        // ── The lighthouse's road: while its lantern burns, its light lies on the water toward
        // the eye as the sun's does, a thin warm column under the tower ──
        If(u.beacon.y.greaterThan(0.01), () => {
            const toLamp = u.lantern.sub(P);
            const lamp = glintLobe(slope, variance.add(0.0012), V, normalize(toLamp));
            const lampRoad = lamp.div(lamp.mul(0.08).add(1.0));
            // (Its strength falls with the water's distance from the tower, gently: it is a lens.)
            const reach = float(1.0).div(float(1.0).add(length(toLamp).div(3500.0)));
            water.addAssign(vec3(1.0, 0.8, 0.5).mul(lampRoad).mul(u.beacon.y).mul(reach)
                .mul(0.5));
        });
        // ── Glints: single facets that catch a light and are gone. They are laid out in the angles
        // the resting eye sees (bearing, depression), so a glint is a few pixels across at any
        // range and stays on its water as the lens drifts; each is a round spot that swells and
        // dies on its own beat. ──
        const rel = xz.sub(vec2(EYE.x, EYE.z));
        const grid = vec2(rel.x.div(max(rel.y.negate(), 1.0)), float(EYE.y).sub(P.y).div(max(length(rel), 1.0)))
            .div(u.pixelAngle.mul(GLINT_PIXELS)).toVar();
        const seed = hcHash22(floor(grid).add(4096.0)).toVar();
        const spotAt = fract(grid).sub(0.5).sub(vec2(seed.y, fract(seed.x.mul(41.3))).sub(0.5).mul(0.45));
        const beat = sin(time.mul(seed.y.mul(3.5).add(2.2)).add(seed.x.mul(40.0))).max(0.0);
        const b2 = beat.mul(beat);
        const glint = exp(dot(spotAt, spotAt).mul(-15.0)).mul(b2.mul(b2).mul(b2)).toVar();
        if (tier.sparkle) {
            // The sun's glitter: a cell lights with the chance that a facet there is tilted to
            // the halfway vector, a wider spread than the road itself (the stray flashes beside it).
            const half = normalize(u.sunDir.add(V)).toVar();
            const miss = half.xz.negate().div(max(half.y, 0.08)).sub(slope);
            const odds = exp(dot(miss, miss).div(max(variance, GLINT_FLOOR).mul(-9.0)));
            const lit = step(float(1.0).sub(odds.mul(0.8)), seed.x).mul(glint).mul(u.sunUp).mul(clouds);
            water.addAssign(u.sun.mul(lit).mul(2.4));
        }
        // ── A gust's patch, a ring's crests, a whirl's arms: the ruffled water darkens, a thread of
        // light runs along each crest and the glints there flash in the event's own colour ──
        If(fxWeight.add(gust).greaterThan(0.01), () => {
            water.mulAssign(float(1.0).sub(gust.clamp(0.0, 1.0).mul(0.18)));
            const tint = gustTint.div(fxWeight.add(gust).max(0.05));
            const lamp = u.sun.mul(u.sunUp).mul(0.18).add(u.fill.mul(2.4)).add(0.6);
            const chance = gust.mul(0.3).add(fxWeight.mul(0.9)).clamp(0.0, 0.92);
            const flashes = step(float(1.0).sub(chance), seed.x).mul(glint).mul(4.2);
            water.addAssign(tint.mul(lamp).mul(flashes.add(crestLight.mul(0.4))));
        });

        // ── The waterline: foam on every shore; the sea runs white after the land rises ──
        const lapping = sin(time.mul(1.3).add(hcLuma(texture(t.noise, xz.div(31.0)).rgb).mul(18.0))).mul(0.5).add(0.5);
        const fresh = u.drain.mul(1.4);
        const swellSurf = u.swell.x.mul(exp(dist.sub(u.swell.y).div(220.0).mul(dist.sub(u.swell.y).div(220.0)).negate()));
        const reachFoam = float(0.35).add(lapping.mul(0.25)).add(fresh.mul(1.2)).add(swellSurf.mul(2.4))
            .add(fresh.add(swellSurf).mul(foot).mul(0.35));
        const churn = texture(t.noise, xz.div(2.3).add(vec2(time.mul(0.05), 0.0))).toVar();
        const foam = float(1.0).sub(smoothstep(0.0, reachFoam, depth)).mul(smoothstep(-0.2, 0.05, depth))
            .mul(churn.g.mul(0.7).add(0.45))
            .mul(float(1.0).sub(smoothstep(900.0, 3000.0, dist)));
        const foamLight = u.sun.mul(max(u.sunDir.y, 0.05).mul(0.5)).mul(shade).mul(u.sunUp).add(u.fill.mul(1.6))
            .mul(0.62);
        // White water on a splash's lead crest and on the rebound's wave: broken, never a ruled band.
        const broken = churn.r.mul(1.3).add(0.15);
        water.assign(mix(water, foamLight, clamp(foam.add(whiteWater.mul(broken)), 0.0, 0.85)));

        const col = aerial(u, P, water);
        return vec4(col, 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'HighCoastSea';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return {
        mesh,
        meshes: [mesh],
        update() {},
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export { min, sin };
