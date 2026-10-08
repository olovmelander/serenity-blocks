/**
 * Fluid Dreams — the liquid: one material that traces every view ray through the dreaming sea.
 *
 * Everything liquid in the picture is ONE distance field: the sea (a height field), the balls of
 * the choreography's table and the thread that holds the Great Drop up, joined by an exponential
 * smooth minimum. Nothing is painted on — drops bridging to the sea, necks thinning until they
 * pinch off, a droplet sinking into its own splash all fall out of the union. The same union
 * hands the shading a blend weight ("how much drop, how much sea") and a softmax-weighted normal,
 * tint and lens, so two merged drops share one surface, one colour and one refracted image.
 *
 * A ray is followed for a few bounces: sea → drop → sky gives the Drop its mirror image in the
 * sea, drop → sea → sky gives the sea back in the Drop's belly. A drop is a lens: the ray is bent
 * in, carried across the blended sphere and bent out again, so each one holds the horizon and the
 * dream sun upside down.
 *
 * Cost: balls are grouped, each group has a bounding sphere, and a ray only marches through the
 * interval where it crosses the groups it can meet (evaluating only their balls). Everywhere else
 * the sea is the plane settled onto its swell in closed form.
 */
import * as THREE from 'three/webgpu';
import {
    Break, Fn, If, Loop, abs, acos, cameraPosition, clamp, cos, dot, exp, float, floor, int, length,
    log, log2, max, min, mix, normalize, positionWorld, pow, reflect, refract, select, sin, smoothstep,
    sqrt, texture, uniform, uniformArray, vec2, vec3, vec4,
} from 'three/tsl';
import {
    FLUID_PALETTES, GROUP_BLEND, GROUP_COUNT, GROUP_HERO, GROUP_START, SMOOTH_K, TAU,
} from './fluid-dreams-core.js';
import { NOISE_SIZE, fdHash33, fdMax3 } from './fluid-dreams-tsl.js';

const INV_K = 1 / SMOOTH_K;
/** The sea term is a height, not a distance: scale it so a sloped swell stays conservative. */
const SEA_LIP = 0.75;
const HIT_EPS = 0.004;
/** The deepest trough the sea can show (metres below its rest level). */
const SEA_REACH = 1.6;
/** Shading attributes (tint, lens) blend across a union over about this many metres. */
const SHADE_WIDTH = 1.0;
/** Air between the camera and what it sees (per metre). */
const HAZE = 0.0034;
/** The swell: two trains of long waves (wave vector, amplitude, rate). */
const SWELL = Object.freeze([
    { k: [0.31, 0.17], amp: 0.1, rate: 0.55 },
    { k: [-0.21, 0.43], amp: 0.065, rate: -0.47 },
]);
/**
 * Drops far out on the sea, as (bearing °, elevation °, angular radius °): spread across the
 * view, clear of the dream sun.
 */
export const FAR_DROPS = Object.freeze([
    [-52, 2.4, 0.7], [-36.5, 3.0, 0.9], [-29, 1.6, 0.45], [-15.5, 2.1, 0.62], [-11.5, 1.2, 0.33],
    [22.5, 1.5, 0.42], [26.5, 2.8, 0.8], [39, 1.9, 0.55], [56, 2.3, 0.64],
]);
/** Nothing of a far drop shows above this height in the sky (sine of its elevation): skip the rest. */
const FAR_BAND = Math.max(
    ...FAR_DROPS.map(([, elevation, size]) => Math.sin(((elevation + size * 1.2) * Math.PI) / 180)),
);
/** The key light: behind the viewer, up and to the left. */
const KEY_DIR = vec3(-0.42, 0.52, 0.74).normalize();
/** Crests inside a ring train's envelope. */
const RING_CRESTS = 3.3;

/**
 * Every uniform the liquid reads. The world owns the values; the material only reads.
 * @param {{ balls: object[], groups: object[], rings: object[], dye: object[], waves: object[] }} tables
 * @param {THREE.Texture} noise
 */
export function createLiquidUniforms(tables, noise) {
    const p = FLUID_PALETTES[0];
    const v3 = (a) => uniform(new THREE.Vector3(a[0], a[1], a[2]));
    return {
        noise,
        time: uniform(0),
        /** Drawing buffer, pixels (the sprites size themselves in it). */
        viewport: uniform(new THREE.Vector2(1920, 1080)),
        sprayGain: uniform(1),
        moteGain: uniform(1),
        /** Radians one pixel subtends: picks the ripple texture's mip, sizes the stars. */
        pixelAngle: uniform(0.001),
        /** Two rows per ball: (x, y, z, radius), (r, g, b, glow). */
        balls: uniformArray(tables.balls, 'vec4'),
        /** Two rows per group: (centre, bound radius), (live balls, of which the first n are one body, -, -). */
        groups: uniformArray(tables.groups, 'vec4'),
        /** Two rows per ring train: (x, z, radius, amplitude), (r, g, b, width). */
        rings: uniformArray(tables.rings, 'vec4'),
        /** Two rows per stain: (x, z, radius, strength), (r, g, b, -). */
        dye: uniformArray(tables.dye, 'vec4'),
        /** Two rows per wave packet: (x, z, radius, amplitude), (width, crests, light, -). */
        waves: uniformArray(tables.waves, 'vec4'),
        /** Far drops: (unit direction, angular radius in chord units). */
        far: uniformArray(FAR_DROPS.map(([bearing, elevation, size]) => {
            const b = (bearing * Math.PI) / 180;
            const e = (elevation * Math.PI) / 180;
            const flat = Math.cos(e);
            return new THREE.Vector4(Math.sin(b) * flat, Math.sin(e), -Math.cos(b) * flat, (size * Math.PI) / 180);
        }), 'vec4'),
        /** Live rows: rings, stains, packets. */
        counts: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The thread: foot (x, z), the height its top flare begins, the height it is cut at. */
        stem: uniform(new THREE.Vector4(0, 0, 5, 8)),
        /** Waist radius, foot radius, top radius, and an offset that pushes the thread out of the field. */
        stemShape: uniform(new THREE.Vector4(0.2, 1.1, 0.9, 9)),
        /** Two beads of liquid climbing the thread: (height, swell) each. */
        stemBeads: uniform(new THREE.Vector4(-10, 0, -10, 0)),
        stemTint: uniform(new THREE.Vector4(0.6, 0.3, 1.0, 0)),
        /** A funnel in the sea: (x, z, depth, radius). */
        vortex: uniform(new THREE.Vector4(0, 0, 0, 6)),
        /** Its spiral arms: (phase, strength, -, -). */
        vortexSpin: uniform(new THREE.Vector4(0, 0, 0, 0)),
        /** The Great Drop: centre and radius (its lens, the light it pools on the sea). */
        hero: uniform(new THREE.Vector4(-10, 9.5, -23, 3.3)),
        /**
         * Its body is a union of its own, far softer than the sea's: (blend radius, that radius
         * over SMOOTH_K, the weight that takes the union's swelling back out, glow).
         */
        heroBlend: uniform(new THREE.Vector4(1.5, 3, 0.05, 0)),
        /** Direction from the camera to the Great Drop: where the prism ring opens from. */
        heroDir: uniform(new THREE.Vector3(-0.38, 0.28, -0.88).normalize()),
        sunDir: uniform(new THREE.Vector3(0.33, 0.07, -0.94).normalize()),
        zenith: v3(p.zenith),
        mid: v3(p.mid),
        horizon: v3(p.horizon),
        sun: v3(p.sun),
        inkA: v3(p.inkA),
        inkB: v3(p.inkB),
        inkC: v3(p.inkC),
        deep: v3(p.deep),
        glow: v3(p.glow),
        /** 0..1.4: the sea's own motion (a hush stills it). */
        swell: uniform(1),
        /** 0..1: the charge a chain of clears builds. */
        charge: uniform(0),
        /** 0..1.3: the overdrive after a four-line clear. */
        surge: uniform(0),
        /** A prismatic ring crossing the sky: (angular radius, strength, width, -). */
        prism: uniform(new THREE.Vector4(0, 0, 0.06, 0)),
        /** The film on every drop: (strength, thickness shift µm, -, -). */
        film: uniform(new THREE.Vector4(1, 0, 0, 0)),
        skyFlash: uniform(0),
    };
}

/**
 * @param {object} options
 * @param {object} options.uniforms from createLiquidUniforms()
 * @param {number} options.steps march budget of a view ray
 * @param {number} options.bounceSteps march budget of a reflected ray
 * @param {number} options.bounces rays followed per pixel (1 = no inter-reflection)
 * @param {boolean} options.stars resolve stars
 * @param {boolean} options.warp fold the sky's ink through itself (two more fetches)
 * @param {boolean} options.dispersion a drop's lens splits red and blue (two more sky reads per drop pixel)
 * @param {boolean} options.farDrops draw the drops far out on the sea
 * @param {boolean} options.mirrorExtras a mirrored ray also meets the Great Drop's satellites and crown
 *   (off: only its body and thread, a fraction of the balls)
 */
export function createLiquidMaterial({
    uniforms: u, steps = 56, bounceSteps = 24, bounces = 2, stars = true, warp = true, dispersion = false,
    farDrops = true, mirrorExtras = true,
}) {
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
    });
    material.name = 'Fluid Dreams — liquid';

    const noiseAt = (uvNode, lod = 0) => texture(u.noise, uvNode).level(lod);

    // ── The sea ─────────────────────────────────────────────────────────────────

    const swellPhase = (xz, w) => xz.x.mul(w.k[0]).add(xz.y.mul(w.k[1])).add(u.time.mul(w.rate));

    /** The sea's height at a point: the swell, the packets a clear sends out, a funnel. */
    const seaHeight = (xz) => {
        const h = sin(swellPhase(xz, SWELL[0])).mul(SWELL[0].amp)
            .add(sin(swellPhase(xz, SWELL[1])).mul(SWELL[1].amp))
            .mul(u.swell)
            .toVar();
        Loop({
            start: int(0), end: int(u.counts.z), type: 'int', condition: '<', name: 'wv',
        }, ({ wv }) => {
            const A = u.waves.element(wv.mul(2));
            const S = u.waves.element(wv.mul(2).add(1));
            const x = length(xz.sub(A.xy)).sub(A.z).div(S.x).toVar();
            h.addAssign(exp(x.mul(x).negate()).mul(cos(x.mul(S.y))).mul(A.w));
        });
        If(u.vortex.z.greaterThan(0.001), () => {
            const v = xz.sub(u.vortex.xy);
            h.subAssign(exp(dot(v, v).div(u.vortex.w.mul(u.vortex.w)).negate()).mul(u.vortex.z));
        });
        return h;
    };

    /**
     * The sea's slope and the light running in it at a point: everything in seaHeight, the ring
     * trains (too fine to march) and two layers of wind ripple. `foot` = metres a pixel covers.
     */
    const seaDetail = (xz, foot) => {
        const slope = vec2(0).toVar();
        const light = vec3(0).toVar();
        slope.assign(vec2(SWELL[0].k[0], SWELL[0].k[1]).mul(cos(swellPhase(xz, SWELL[0])).mul(SWELL[0].amp))
            .add(vec2(SWELL[1].k[0], SWELL[1].k[1]).mul(cos(swellPhase(xz, SWELL[1])).mul(SWELL[1].amp)))
            .mul(u.swell));
        Loop({
            start: int(0), end: int(u.counts.z), type: 'int', condition: '<', name: 'wd',
        }, ({ wd }) => {
            const A = u.waves.element(wd.mul(2));
            const S = u.waves.element(wd.mul(2).add(1));
            const v = xz.sub(A.xy).toVar();
            const rho = max(length(v), 1e-3).toVar();
            const x = rho.sub(A.z).div(S.x).toVar();
            const env = exp(x.mul(x).negate()).toVar();
            const c = cos(x.mul(S.y)).toVar();
            const dh = A.w.mul(env).mul(x.mul(-2).mul(c).sub(S.y.mul(sin(x.mul(S.y))))).div(S.x);
            slope.addAssign(v.div(rho).mul(dh));
            light.addAssign(mix(u.horizon, u.glow, 0.5).mul(env.mul(S.z).mul(c.mul(0.5).add(0.5))));
        });
        Loop({
            start: int(0), end: int(u.counts.x), type: 'int', condition: '<', name: 'rg',
        }, ({ rg }) => {
            const R = u.rings.element(rg.mul(2));
            const C = u.rings.element(rg.mul(2).add(1));
            const v = xz.sub(R.xy).toVar();
            const rho = max(length(v), 1e-3).toVar();
            const x = rho.sub(R.z).div(C.w).toVar();
            const env = exp(x.mul(x).negate()).toVar();
            const c = cos(x.mul(RING_CRESTS)).toVar();
            const dh = R.w.mul(env).mul(x.mul(-2).mul(c).sub(sin(x.mul(RING_CRESTS)).mul(RING_CRESTS))).div(C.w);
            slope.addAssign(v.div(rho).mul(dh));
            light.addAssign(C.xyz.mul(env.mul(R.w).mul(c.mul(0.45).add(0.55)).mul(6.0)));
        });
        If(u.vortex.z.greaterThan(0.001), () => {
            const v = xz.sub(u.vortex.xy).toVar();
            const r2 = u.vortex.w.mul(u.vortex.w);
            const e = exp(dot(v, v).div(r2).negate()).toVar();
            slope.addAssign(v.mul(e.mul(u.vortex.z).mul(2).div(r2)));
            // spiral arms: ridges that wind into the funnel
            const rho = max(length(v), 0.05).toVar();
            const dirR = v.div(rho).toVar();
            const dirT = vec2(dirR.y.negate(), dirR.x);
            const wide = exp(dot(v, v).div(r2.mul(5.0)).negate());
            const ph = rho.mul(1.5).sub(u.vortexSpin.x)
                .add(dirR.x.mul(3.0)).add(dirR.y.mul(1.7)); // a cheap winding without atan
            const s = sin(ph).mul(u.vortexSpin.y).mul(wide);
            slope.addAssign(dirR.mul(1.5).add(dirT.mul(float(1.2).div(rho.add(1.0)))).mul(s));
        });
        // wind ripple: stored slopes, read at the mip the pixel's footprint asks for
        const lodA = log2(max(foot.mul(NOISE_SIZE * 0.085), 1.0));
        const lodB = log2(max(foot.mul(NOISE_SIZE * 0.31), 1.0));
        const nA = noiseAt(xz.mul(0.085).add(vec2(u.time.mul(0.011), u.time.mul(0.007))), lodA).yz.sub(0.5);
        const nB = noiseAt(xz.mul(0.31).add(vec2(u.time.mul(-0.019), u.time.mul(0.023))), lodB).yz.sub(0.5);
        slope.addAssign(nA.mul(0.26).add(nB.mul(0.13)).mul(u.swell.mul(0.7).add(0.3)));
        return { slope, light };
    };

    // ── The sky ─────────────────────────────────────────────────────────────────

    /** The sky in a direction. `full` adds the folded ink, the stars and the prism ring. */
    const skyColour = (dirIn, full) => {
        const dir = vec3(dirIn).toVar();
        const ay = abs(dir.y).toVar();
        const c = mix(u.horizon, u.mid, smoothstep(0.0, 0.13, ay)).toVar();
        c.assign(mix(c, u.zenith, smoothstep(0.08, 0.62, ay)));
        // a band of light lying on the sea line
        c.addAssign(u.horizon.mul(exp(ay.mul(-24.0)).mul(0.5)));
        const up = vec3(dir.x, ay, dir.z).toVar();
        const cs = clamp(dot(up, u.sunDir), 0.0, 1.0).toVar();
        const cs4 = cs.mul(cs).mul(cs).mul(cs).toVar();
        const cs16 = cs4.mul(cs4).mul(cs4).mul(cs4).toVar();
        const cs64 = cs16.mul(cs16).mul(cs16).mul(cs16);
        c.addAssign(u.sun.mul(cs4.mul(cs4).mul(0.2).add(cs64.mul(0.9))
            .add(smoothstep(0.99895, 0.99978, cs).mul(6.0))));

        // a soft light behind the viewer: never seen itself, it is the window in every drop
        const key = clamp(dot(dir, KEY_DIR), 0.0, 1.0).toVar();
        const key8 = key.mul(key).mul(key).mul(key).mul(key)
            .mul(key)
            .mul(key)
            .mul(key)
            .toVar();
        c.addAssign(mix(u.glow, vec3(1.0), 0.6).mul(key8.mul(key8).mul(key8).mul(2.6)));

        // ink adrift overhead, receding to the sea line like a ceiling of cloud
        const P = up.xz.div(ay.add(0.3)).toVar();
        const drift = vec2(u.time.mul(0.0042), u.time.mul(0.0027)).toVar();
        const n1 = noiseAt(P.mul(0.105).add(drift)).w.toVar();
        const n2 = n1.toVar();
        if (full && warp) {
            const fold = noiseAt(P.mul(0.19).sub(drift.mul(1.7)).add(0.37)).w.toVar();
            n2.assign(noiseAt(P.mul(0.26).add(vec2(n1, fold).mul(0.32)).add(drift.mul(2.3))).w);
        }
        const band = smoothstep(0.02, 0.3, ay).mul(float(1.0).sub(smoothstep(0.7, 1.0, ay).mul(0.45)));
        const dens = smoothstep(0.44, 0.86, n1.mul(0.62).add(n2.mul(0.5))).mul(band);
        const hue = mix(mix(u.inkA, u.inkB, smoothstep(0.3, 0.68, n2)), u.inkC, smoothstep(0.5, 0.9, n1).mul(0.55));
        c.addAssign(hue.mul(dens).mul(u.charge.mul(0.7).add(0.5).add(u.surge.mul(0.4))));

        if (full) {
            if (stars) {
                const sp = dir.mul(84.0).toVar();
                const cell = floor(sp).toVar();
                const h = fdHash33(cell).toVar();
                const off = sp.sub(cell).sub(0.5).sub(h.sub(0.5).mul(0.7));
                const sigma = max(u.pixelAngle.mul(84.0), 0.02);
                const core = exp(dot(off, off).negate().div(sigma.mul(sigma)));
                const z2 = h.z.mul(h.z);
                const z8 = z2.mul(z2).mul(z2).mul(z2);
                const twinkle = sin(u.time.mul(h.x.mul(3.0).add(1.5)).add(h.y.mul(40.0))).mul(0.3).add(0.7);
                const seen = smoothstep(0.03, 0.3, dir.y).mul(float(1.0).sub(dens.mul(0.8)));
                c.addAssign(mix(vec3(1.0, 0.82, 0.9), vec3(0.75, 0.9, 1.0), h.x)
                    .mul(core.mul(z8.mul(h.z).mul(7.0).add(z2.mul(0.25))).mul(twinkle).mul(seen)));
            }
            if (farDrops) {
                // Far out, other drops hang on their own threads: too far to trace, so each is
                // a disc shaded as the lens it is (the sea line bent across its middle, a lit
                // rim) and a hair of light under it.
                If(dir.y.greaterThan(-0.004).and(dir.y.lessThan(FAR_BAND)), () => Loop({
                    start: int(0), end: int(FAR_DROPS.length), type: 'int', condition: '<', name: 'fd',
                }, ({ fd }) => {
                    const D = u.far.element(fd);
                    const off = dir.sub(D.xyz).toVar();
                    const r = length(off).div(D.w).toVar();
                    If(r.lessThan(1.0), () => {
                        const nz = sqrt(float(1.0).sub(r.mul(r)));
                        const v = off.y.div(D.w);
                        const body = mix(u.mid.mul(0.9), u.zenith.mul(2.0), smoothstep(-0.2, 0.7, v))
                            .add(u.horizon.mul(exp(v.add(0.15).mul(v.add(0.15)).mul(-14.0)).mul(0.7)));
                        const rim = float(1.0).sub(nz);
                        const lit = body.add(mix(u.horizon, u.glow, 0.35).mul(rim.mul(rim).mul(1.5)));
                        c.assign(mix(c, mix(lit, c, 0.45), float(1.0).sub(smoothstep(0.82, 1.0, r))));
                    });
                    // its thread: a hair of light from the sea line to its foot
                    const side = length(normalize(dir.xz).sub(normalize(D.xz)));
                    const hair = float(1.0).sub(smoothstep(0.0, D.w.mul(0.09), side))
                        .mul(smoothstep(0.0, 0.004, dir.y))
                        .mul(float(1.0).sub(smoothstep(D.y.sub(D.w.mul(1.1)), D.y.sub(D.w.mul(0.8)), dir.y)));
                    c.addAssign(mix(u.horizon, u.glow, 0.4).mul(hair.mul(0.22)));
                }));
            }
            If(u.prism.y.greaterThan(0.001), () => {
                // a ring of split light opening from the Great Drop
                const ang = acos(clamp(dot(dir, u.heroDir), -1.0, 1.0));
                const x = ang.sub(u.prism.x).div(u.prism.z).toVar();
                const bandP = exp(x.mul(x).negate());
                const spec = cos(vec3(0.0, 0.33, 0.67).add(x.mul(0.3)).mul(TAU)).mul(0.5).add(0.5);
                c.addAssign(mix(spec, vec3(1.0), 0.28).mul(bandP).mul(u.prism.y));
            });
        }
        c.mulAssign(u.skyFlash.mul(0.45).add(1.0));
        // below the sea line: what a ray that leaves the picture downward meets
        const under = smoothstep(0.0, -0.22, dir.y);
        return mix(c, c.mul(vec3(0.4, 0.36, 0.55)).add(u.deep), under);
    };

    // ── The field ───────────────────────────────────────────────────────────────

    /**
     * The groups this ray can meet. A group's balls are joined by a soft union of their own
     * (GROUP_BLEND), and that union is handed on as ONE term of the sea's:
     * each(weight in the group, offset, distance, index, signed distance, group accumulator) per
     * ball, then done(the group's term, its accumulator).
     */
    const ballTerms = (p, flags, primary, each, done) => {
        for (let g = 0; g < GROUP_COUNT; g += 1) {
            // (a mirrored ray may be spared the Great Drop's satellites and crown)
            const crossed = flags[g].greaterThan(0.5);
            If(g === GROUP_HERO && !mirrorExtras ? crossed.and(primary) : crossed, () => {
                const row = u.groups.element(int(g * 2 + 1));
                const end = int(row.x).add(GROUP_START[g]);
                // the Great Drop's body (the first balls of its group) is a term of its own
                const start = g === GROUP_HERO ? int(row.y).add(GROUP_START[g]) : int(GROUP_START[g]);
                const sum = float(1e-30).toVar();
                const acc = each ? vec3(0).toVar() : null;
                Loop({
                    start, end, type: 'int', condition: '<', name: 'bi',
                }, ({ bi }) => {
                    const B = u.balls.element(bi.mul(2));
                    const v = p.sub(B.xyz).toVar();
                    const len = length(v).toVar();
                    const e = exp(clamp(B.w.sub(len).mul(1 / GROUP_BLEND[g]), -60.0, 30.0)).toVar();
                    sum.addAssign(e);
                    if (each) each(e, v, len, bi, len.sub(B.w), acc);
                });
                // exp(−d/k) with d = −kg·log(sum)
                done(pow(sum, GROUP_BLEND[g] / SMOOTH_K), acc);
            });
        }
    };

    /**
     * The Great Drop's body: its balls joined by a soft union of their own, then handed on as
     * ONE term of the sea's union. each(weight, offset, distance) per ball; done(term weight).
     */
    const bodyTerm = (p, flags, each, done) => {
        const live = u.groups.element(int(GROUP_HERO * 2 + 1)).y;
        If(flags[GROUP_HERO].greaterThan(0.5).and(live.greaterThan(0.5)), () => {
            const sum = float(1e-30).toVar();
            Loop({
                start: int(GROUP_START[GROUP_HERO]),
                end: int(live).add(GROUP_START[GROUP_HERO]),
                type: 'int',
                condition: '<',
                name: 'hb',
            }, ({ hb }) => {
                const B = u.balls.element(hb.mul(2));
                const v = p.sub(B.xyz).toVar();
                const len = length(v).toVar();
                const e = exp(clamp(B.w.sub(len).div(u.heroBlend.x), -60.0, 20.0)).toVar();
                sum.addAssign(e);
                if (each) each(e, v, len);
            });
            // exp(−d/k) with d = −kh·log(sum) + bias
            done(pow(sum, u.heroBlend.y).mul(u.heroBlend.z));
        });
    };

    const stemRadius = (y) => {
        const x1 = y.sub(u.stemBeads.x).div(0.6);
        const x2 = y.sub(u.stemBeads.z).div(0.6);
        const rope = sin(y.mul(2.6).sub(u.time.mul(2.1))).mul(0.3)
            .add(sin(y.mul(1.1).sub(u.time.mul(1.3)).add(1.7)).mul(0.25))
            .add(1.0);
        return u.stemShape.x.add(min(u.stemShape.x, 0.16).mul(rope.sub(1.0)))
            .add(u.stemShape.y.sub(u.stemShape.x).mul(exp(max(y, 0.0).mul(-0.62))))
            .add(u.stemShape.z.sub(u.stemShape.x).mul(exp(max(u.stem.z.sub(y), 0.0).mul(-2.3))))
            .add(exp(x1.mul(x1).negate()).mul(u.stemBeads.y))
            .add(exp(x2.mul(x2).negate()).mul(u.stemBeads.w));
    };

    /** The thread under the Great Drop: cb(weight, axis offset, axis distance, radius, sway). */
    const stemTerm = (p, flags, cb) => {
        If(flags[GROUP_HERO].greaterThan(0.5).and(u.stemShape.w.lessThan(4.0)), () => {
            const span = clamp(p.y.div(max(u.stem.z, 0.1)), 0.0, 1.0).toVar();
            const sway = vec2(
                sin(p.y.mul(0.55).add(u.time.mul(0.8))),
                cos(p.y.mul(0.47).add(u.time.mul(0.63))),
            ).mul(span.mul(float(1.0).sub(span)).mul(1.1)).toVar();
            const a = p.xz.sub(u.stem.xy).sub(sway).toVar();
            const la = max(length(a), 1e-4).toVar();
            const r = stemRadius(p.y).toVar();
            const dd = max(la.sub(r), p.y.sub(u.stem.w)).mul(0.8).add(u.stemShape.w).toVar();
            cb(exp(clamp(dd.mul(-INV_K), -60.0, 60.0)), a, la, r, dd);
        });
    };

    // ── One ray, a few bounces ──────────────────────────────────────────────────

    material.fragmentNode = Fn(() => {
        const o = cameraPosition.toVar();
        const d = normalize(positionWorld.sub(cameraPosition)).toVar();
        const view = d.toVar();
        const col = vec3(0).toVar();
        const thr = vec3(1).toVar();
        const primaryMiss = float(0).toVar();
        const haze = float(0).toVar();
        const travel = float(0).toVar();

        Loop({
            start: int(0), end: int(bounces), type: 'int', condition: '<', name: 'bn',
        }, ({ bn }) => {
            // ── which liquid can this ray meet, and where ──
            const tA = float(1e5).toVar();
            const tB = float(-1).toVar();
            const flags = [];
            for (let g = 0; g < GROUP_COUNT; g += 1) {
                const flag = float(0).toVar();
                flags.push(flag);
                const G = u.groups.element(int(g * 2));
                const live = u.groups.element(int(g * 2 + 1)).x;
                const oc = o.sub(G.xyz).toVar();
                const b = dot(oc, d).toVar();
                const disc = b.mul(b).sub(dot(oc, oc).sub(G.w.mul(G.w))).toVar();
                If(disc.greaterThan(0.0).and(live.greaterThan(0.5)), () => {
                    const s = sqrt(disc).toVar();
                    If(s.sub(b).greaterThan(0.0), () => {
                        flag.assign(1.0);
                        tA.assign(min(tA, max(b.negate().sub(s), 0.0)));
                        tB.assign(max(tB, s.sub(b)));
                    });
                });
            }
            const down = d.y.lessThan(-1e-4).toVar();
            // Nothing under the sea is seen: a falling ray's march ends just below the surface
            // (and never starts if the ray meets the sea before it reaches any group).
            If(down, () => {
                tB.assign(min(tB, o.y.add(SEA_REACH).div(d.y.negate())));
            });
            const t = tA.toVar();
            const hit = float(0).toVar(); // 1 = the field, 2 = the open sea
            If(tB.greaterThan(tA), () => {
                Loop({
                    start: int(0),
                    end: select(bn.equal(int(0)), int(steps), int(bounceSteps)),
                    type: 'int',
                    condition: '<',
                    name: 'st',
                }, () => {
                    const p = o.add(d.mul(t)).toVar();
                    const hs = p.y.sub(seaHeight(p.xz)).toVar();
                    // a rising ray cannot meet the sea: only the liquid above it
                    const eSea = select(down, exp(clamp(hs.mul(-SEA_LIP * INV_K), -60.0, 60.0)), 0.0).toVar();
                    const eB = float(1e-30).toVar();
                    ballTerms(p, flags, bn.equal(int(0)), null, (e) => eB.addAssign(e));
                    bodyTerm(p, flags, null, (e) => eB.addAssign(e));
                    stemTerm(p, flags, (e) => eB.addAssign(e));
                    const dB = log(eB).mul(-SMOOTH_K).toVar();
                    const dAll = log(eB.add(eSea)).mul(-SMOOTH_K).toVar();
                    If(dAll.lessThan(t.mul(0.04).add(1.0).mul(HIT_EPS)), () => {
                        // A march that begins under the surface met the sea before it reached
                        // this group: that is the open sea's to shade.
                        hit.assign(select(hs.lessThan(-0.04).and(t.lessThan(tA.add(1e-3))), 0.0, 1.0));
                        Break();
                    });
                    // Far from every ball the sea is a plane the ray reaches in one stride;
                    // near one, the union is traced as it is.
                    const toSea = select(down, hs.div(max(d.y.negate(), 1e-3)).mul(0.9), 1e5);
                    const stride = select(
                        dB.greaterThan(SMOOTH_K * 3.5),
                        min(dB.sub(SMOOTH_K * 2.5), toSea),
                        dAll.mul(0.92),
                    );
                    t.addAssign(max(stride, 0.012));
                    If(t.greaterThan(tB), () => {
                        Break();
                    });
                });
            });
            If(hit.lessThan(0.5).and(down), () => {
                // the open sea: the plane, settled onto its swell
                t.assign(max(o.y.negate().div(min(d.y, -1e-4)), 0.0));
                Loop({
                    start: int(0), end: int(2), type: 'int', condition: '<', name: 'rf',
                }, () => {
                    const q = o.add(d.mul(t));
                    t.addAssign(clamp(q.y.sub(seaHeight(q.xz)).div(max(d.y.negate(), 0.06)), -2.5, 2.5));
                });
                hit.assign(2.0);
            });
            If(hit.lessThan(0.5), () => {
                If(bn.equal(int(0)), () => {
                    primaryMiss.assign(1.0);
                });
                Break();
            });

            // ── what is here: how much drop, how much sea ──
            const p = o.add(d.mul(t)).toVar();
            const eSea = float(1).toVar();
            const eB = float(0).toVar();
            const grad = vec3(0).toVar();
            const tint = vec3(0).toVar();
            const glow = float(0).toVar();
            const radius = float(0).toVar();
            const wide = float(1e-30).toVar();
            If(hit.lessThan(1.5), () => {
                eSea.assign(exp(clamp(p.y.sub(seaHeight(p.xz)).mul(-SEA_LIP * INV_K), -60.0, 60.0)));
                ballTerms(p, flags, bn.equal(int(0)), (e, v, len, index, dd, acc) => {
                    const B = u.balls.element(index.mul(2));
                    const C = u.balls.element(index.mul(2).add(1));
                    const ws = exp(clamp(dd.mul(-1 / SHADE_WIDTH), -60.0, 60.0)).toVar();
                    acc.addAssign(v.div(max(len, 1e-4)).mul(e));
                    wide.addAssign(ws);
                    tint.addAssign(C.xyz.mul(ws));
                    glow.addAssign(C.w.mul(ws));
                    radius.addAssign(B.w.mul(ws));
                }, (e, acc) => {
                    const w = e.toVar();
                    eB.addAssign(w);
                    grad.addAssign(acc.div(max(length(acc), 1e-30)).mul(w));
                });
                const bodyGrad = vec3(0).toVar();
                bodyTerm(p, flags, (e, v, len) => {
                    bodyGrad.addAssign(v.div(max(len, 1e-4)).mul(e));
                }, (e) => {
                    // one body: one normal field, and ONE lens (no seam where its lobes meet)
                    const w = e.toVar();
                    const ws = pow(w, SMOOTH_K / SHADE_WIDTH).toVar();
                    eB.addAssign(w);
                    grad.addAssign(bodyGrad.div(max(length(bodyGrad), 1e-30)).mul(w));
                    wide.addAssign(ws);
                    tint.addAssign(u.stemTint.xyz.mul(ws));
                    glow.addAssign(u.heroBlend.w.mul(ws));
                    radius.addAssign(u.hero.w.mul(ws));
                });
                stemTerm(p, flags, (e, a, la, r, dd) => {
                    const w = e.toVar();
                    const ws = exp(clamp(dd.mul(-1 / SHADE_WIDTH), -60.0, 60.0)).toVar();
                    const dr = stemRadius(p.y.add(0.06)).sub(stemRadius(p.y.sub(0.06))).div(0.12);
                    eB.addAssign(w);
                    grad.addAssign(normalize(vec3(a.x.div(la), dr.negate(), a.y.div(la))).mul(w));
                    wide.addAssign(ws);
                    tint.addAssign(u.stemTint.xyz.mul(ws));
                    glow.addAssign(u.stemTint.w.mul(ws));
                    radius.addAssign(r.mul(ws));
                });
            });
            // how much drop: a hair of it is no drop at all (no halo where a group's bound ends)
            const blob = smoothstep(0.02, 0.98, eB.div(eB.add(eSea))).toVar();
            const inv = float(1.0).div(wide).toVar();
            tint.mulAssign(inv);
            glow.mulAssign(inv);
            radius.mulAssign(inv);
            travel.addAssign(t);

            // ── the surface ──
            const n = vec3(0, 1, 0).toVar();
            const seaLight = vec3(0).toVar();
            If(blob.lessThan(0.995), () => {
                const foot = travel.mul(u.pixelAngle).div(max(abs(d.y), 0.04));
                const { slope, light } = seaDetail(p.xz, foot);
                n.assign(normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())));
                seaLight.assign(light);
            });
            If(blob.greaterThan(0.005), () => {
                n.assign(normalize(mix(n, normalize(grad), blob)));
            });
            const ndv = clamp(dot(n, d.negate()), 0.0, 1.0).toVar();
            const f1 = float(1.0).sub(ndv).toVar();
            const f5 = f1.mul(f1).mul(f1).mul(f1).mul(f1)
                .toVar();

            // ── the sea's own light ──
            const seaLocal = vec3(0).toVar();
            const seaFilm = vec3(1).toVar();
            If(blob.lessThan(0.995), () => {
                const xz = p.xz.toVar();
                const stain = vec3(0).toVar();
                Loop({
                    start: int(0), end: int(u.counts.y), type: 'int', condition: '<', name: 'dy',
                }, ({ dy }) => {
                    const D = u.dye.element(dy.mul(2));
                    const C = u.dye.element(dy.mul(2).add(1));
                    const v = xz.sub(D.xy);
                    stain.addAssign(C.xyz.mul(exp(dot(v, v).div(D.z.mul(D.z)).negate()).mul(D.w)));
                });
                // the colours lie in the water as marbled ink, not as discs
                const foot = travel.mul(u.pixelAngle).div(max(abs(d.y), 0.04));
                const marble = noiseAt(
                    xz.mul(0.07).add(vec2(u.time.mul(0.008), u.time.mul(-0.006))),
                    log2(max(foot.mul(NOISE_SIZE * 0.07), 1.0)).add(1.0),
                ).w.toVar();
                const veins = smoothstep(0.3, 0.75, marble).mul(1.25).add(0.2);
                const seaOpd = marble.mul(0.9).add(0.25).add(u.film.y).mul(2.66)
                    .mul(sqrt(float(1.0).sub(float(1.0).sub(ndv.mul(ndv)).mul(0.5653))));
                const seaIr = cos(vec3(1 / 0.65, 1 / 0.532, 1 / 0.45).mul(seaOpd).mul(TAU)).mul(0.5).add(0.5);
                seaFilm.assign(mix(vec3(1.0), seaIr.mul(1.5).add(0.25), u.film.x.mul(0.34)));
                const hv = xz.sub(u.hero.xz);
                const pool = exp(dot(hv, hv).div(u.hero.w.mul(u.hero.w).mul(7.0)).negate());
                // many stains together deepen; they do not sum to white
                stain.divAssign(fdMax3(stain).mul(0.55).add(1.0));
                // what glows under the surface is seen through its ripples
                const shimmer = clamp(float(1.35).sub(length(n.xz).mul(4.5)), 0.4, 1.35);
                seaLocal.assign(u.deep.mul(ndv.mul(0.9).add(0.35))
                    .add(stain.mul(veins).mul(shimmer))
                    .add(u.glow.mul(pool).mul(u.charge.mul(0.8).add(u.surge.mul(0.4)).add(0.14))
                        .mul(veins.mul(0.5).add(0.5))
                        .mul(shimmer))
                    .add(seaLight));
            });

            // ── a drop: a lens full of ink ──
            const blobLocal = vec3(0).toVar();
            const filmTint = vec3(1).toVar();
            If(blob.greaterThan(0.005), () => {
                const r1 = refract(d, n, 0.752).toVar();
                // The lens is the sphere that kisses the surface here (centre one radius down
                // the normal), so the image stays whole on any lump of the union.
                const chord = radius.mul(2.0).mul(max(dot(n.negate(), r1), 0.0)).toVar();
                const exitN = normalize(r1.mul(chord).add(n.mul(radius))).toVar();
                const leave = (ior) => {
                    const bent = refract(r1, exitN.negate(), ior).toVar();
                    // total internal reflection returns zero: keep the ray it would have bounced as
                    return select(dot(bent, bent).lessThan(0.25), reflect(r1, exitN.negate()), bent);
                };
                const behind = skyColour(leave(1.33), false).toVar();
                if (dispersion) {
                    // a drop splits the light it bends: the red and the blue leave by their own roads
                    behind.assign(vec3(skyColour(leave(1.3), false).x, behind.y, skyColour(leave(1.365), false).z));
                }

                const back = clamp(dot(r1, u.sunDir), 0.0, 1.0).toVar();
                const back3 = back.mul(back).mul(back);
                const fill = float(1.0).sub(exp(chord.mul(-0.5))).toVar();
                // Beer–Lambert: the liquid keeps its own colour and drinks the rest, by depth
                const through = behind.mul(exp(float(1.0).sub(tint).mul(chord.mul(-0.42))));
                const scatter = tint.mul(fill)
                    .mul(u.mid.mul(0.5).add(u.horizon.mul(0.06)).add(u.sun.mul(back3.mul(back3).mul(0.55))));

                // ink turning inside: it shifts against the surface as the lens bends the view
                const big = smoothstep(0.6, 2.2, radius);
                const q = p.xy.add(r1.xy.mul(chord.mul(0.3))).mul(0.085).toVar();
                const flow = vec2(u.time.mul(0.011), u.time.mul(0.017)).toVar();
                const i1 = noiseAt(q.add(flow)).w.toVar();
                const i2 = noiseAt(q.mul(1.7).sub(flow.mul(1.3)).add(i1.mul(0.3))).w.toVar();
                const dens = smoothstep(0.56, 0.9, i1.mul(0.55).add(i2.mul(0.55))).mul(big).mul(fill).mul(ndv);
                const hue = mix(
                    mix(u.inkA, u.inkB, smoothstep(0.3, 0.7, i2)),
                    u.inkC,
                    smoothstep(0.55, 0.9, i1).mul(0.6),
                );
                const ink = hue.mul(dens).mul(back3.mul(0.6).add(0.7).add(u.charge.mul(1.1)).add(u.surge));

                // Liquid carrying light of its own is less of a window: a lock's droplet reads
                // as its colour against the dark sea and against the sun alike.
                const lit = clamp(glow.mul(0.42), 0.0, 0.88);
                blobLocal.assign(through.mul(float(1.0).sub(lit)).add(scatter).add(ink)
                    .add(tint.mul(glow).mul(ndv.mul(0.55).add(0.45))));

                // the film: interference colours from its thickness and the angle it is seen at
                const fl = noiseAt(
                    n.xy.mul(0.31).add(p.xy.mul(0.045)).add(vec2(u.time.mul(0.013), u.time.mul(-0.009))),
                ).w;
                const thick = fl.mul(0.56).add(0.2).add(float(1.0).sub(n.y).mul(0.11)).add(u.film.y);
                const cosT = sqrt(float(1.0).sub(float(1.0).sub(ndv.mul(ndv)).mul(0.5653)));
                const opd = thick.mul(2.66).mul(cosT);
                const ir = cos(vec3(1 / 0.65, 1 / 0.532, 1 / 0.45).mul(opd).mul(TAU)).mul(0.5).add(0.5);
                filmTint.assign(mix(vec3(1.0), ir.mul(1.9).add(0.12), u.film.x.mul(0.86)));
                // the film mirrors the whole sky at once, not one direction: a sheen of its
                // colours everywhere, strongest where the surface turns away
                const sheen = u.horizon.mul(0.5).add(u.mid.mul(0.9)).add(u.sun.mul(0.12));
                blobLocal.addAssign(ir.mul(sheen).mul(f1.mul(f1).mul(0.85).add(0.1)).mul(u.film.x));
            });

            const local = mix(seaLocal, blobLocal, blob);
            const fresSea = f5.mul(0.96).add(0.04);
            const fresBlob = f5.mul(0.945).add(u.film.x.mul(0.05).add(0.055));
            const F = mix(fresSea, fresBlob, blob).toVar();
            col.addAssign(thr.mul(local).mul(float(1.0).sub(F)));
            thr.mulAssign(mix(seaFilm, filmTint, blob).mul(F));
            If(bn.equal(int(0)), () => {
                haze.assign(float(1.0).sub(exp(t.mul(-HAZE))));
            });

            // ── on: the mirror direction ──
            o.assign(p.add(n.mul(0.03)));
            const rr = reflect(d, n).toVar();
            // a ray leaving the sea stays above the water
            d.assign(normalize(vec3(rr.x, mix(max(rr.y, 0.02), rr.y, blob), rr.z)));
            If(fdMax3(thr).lessThan(0.004), () => {
                Break();
            });
        });

        If(primaryMiss.greaterThan(0.5), () => {
            col.assign(skyColour(d, true));
        }).Else(() => {
            col.addAssign(thr.mul(skyColour(d, false)));
            // the air between the camera and what it sees takes the sea line's light
            const flat = normalize(vec3(view.x, 0.03, view.z));
            const cs = clamp(dot(flat, u.sunDir), 0.0, 1.0).toVar();
            const cs4 = cs.mul(cs).mul(cs).mul(cs);
            const air = u.horizon.mul(0.62).add(u.mid.mul(0.4)).add(u.sun.mul(cs4.mul(cs4).mul(0.3)));
            col.assign(mix(col, air, haze));
        });
        return vec4(col, 1.0);
    })();

    return material;
}

/** The liquid is drawn on a shell around the camera; its owner keeps it centred there. */
export function createLiquidMesh(material) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
    mesh.name = 'Fluid Dreams — liquid shell';
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    mesh.scale.setScalar(900);
    return mesh;
}
