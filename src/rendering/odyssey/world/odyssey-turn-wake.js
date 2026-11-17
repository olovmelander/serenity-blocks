/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE TURN'S WAKE — the living answer to the day's turn (masterpiece pass, round two, 2026-11-17).
 *
 * Between the island's last orb and the mountains' first, a cloud's shade crosses the land and
 * the afternoon's gold breaks out behind it (odyssey-day-turn.js). The shade is weather; this is
 * what the land does about it. A gust travels with the shade's edge, and as it passes:
 *   - LEAVES let go of the broadleaf crowns along the rail: each one leaves its own tree, is
 *     thrown downwind by the gust, tumbles, sways across the wind and sinks to the grass where
 *     the land is (its landing is worked out here, on the island's own height);
 *   - BIRDS lift out of the crowns in three small parties, rise over the forest, wheel once and
 *     settle into trees further downwind;
 *   - the forest's own sway answers (the gust's envelope, returned by `update`).
 *
 * WORLD-ANCHORED AND CONTINUOUS. Every leaf and bird has a tree it leaves and a place it ends:
 * it grows out of the crown it sat in and ends in the grass or in another crown, so nothing
 * appears or goes out in open air. The whole flight is a closed form of the seconds since the
 * gust reached its tree (the vertex stage's CPU twins are `turnWakeLeafAt` / `turnWakeBirdAt`).
 * The gust is let go ONCE per crossing, when the shade's leading edge passes the rail's ground
 * track; a crossing that comes while a wake is still in the air is left alone (nothing resets).
 *
 * REDUCED MOTION: no shade travels, so no gust does either (the caller passes `sweeping`).
 *
 * COST: one instanced draw of alpha-tested quads (no blending, no sorting), drawn only for the
 * ~20 s a wake lasts; at rest the mesh is hidden. Built with the world, so its pipeline compiles
 * with the world's.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, exp, float, length, max, min, mix,
    modelWorldMatrix, positionGeometry, select, sin, smoothstep, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { ODYSSEY_DAY_TURN } from './odyssey-day-turn.js';

export const ODYSSEY_TURN_WAKE = Object.freeze({
    /** The trees that may answer: a box of the world (x, z) round the 18->19 glide's view. */
    reach: Object.freeze({ x: Object.freeze([-560, 240]), z: Object.freeze([-800, -250]) }),
    /** The stretch of forest the glide looks at (world x, z), and how many of its broadleaf
     * trees, nearest first, let leaves go. */
    focus: Object.freeze([-185, -405]),
    trees: 64,
    /** The birds' parties lift from among the nearest `core` of those. */
    core: 30,
    /** The gust is let go only while the rail is this near the focus (u): the turn seen in passing
     * from far up the mountain, on a long flight between chapters, lets nothing go. */
    near: 360,
    /** The gust runs out from the rail at this speed (u/s): the trees answer nearest first. */
    gustSpeed: 150,
    leaves: Object.freeze({
        count: 900,
        /** Half-size (world units): about three times life, as the meadow's butterflies are. */
        size: Object.freeze([0.7, 1.2]),
        /** Each waits up to this long after the gust reaches its tree (seconds). */
        stagger: 3.2,
        /** The gust's throw (u/s, dying over `ease` seconds), the breeze after it, the first lift
         * (u, over `loft` seconds) and the sinking speed (u/s). */
        burst: Object.freeze([9, 24]),
        ease: 1.3,
        drift: Object.freeze([1.6, 3.4]),
        lift: Object.freeze([1.5, 11]),
        loft: 0.9,
        fall: Object.freeze([2.3, 4.4]),
        /** Sway across the wind and bob (u). */
        sway: Object.freeze([0.7, 2.2]),
        bob: 0.35,
        /** Seconds to grow out of the crown, and to settle into the grass. */
        grow: 0.4,
        settle: 0.7,
        /** It has landed when it is this near the ground (u); none flies longer than `maxLife`. */
        land: 0.7,
        maxLife: 13,
    }),
    birds: Object.freeze({
        parties: 3,
        each: 11,
        /** Half the wingspan (u): small birds drawn large enough to read at 150-300 u. */
        size: Object.freeze([1.9, 2.6]),
        /** A party lifts this long after the one before it; each bird within `stagger` of its party. */
        partyGap: 0.9,
        stagger: 1.1,
        /** Seconds in the air, how far downwind they settle (u), the turn of their heading off
         * the wind per party (radians), the height of the arc (u) and the wheel across it (u). */
        life: Object.freeze([9.5, 13]),
        hop: Object.freeze([170, 290]),
        fan: 0.5,
        rise: Object.freeze([34, 60]),
        wheel: Object.freeze([8, 24]),
        turns: 1.0,
        /** Wingbeats (rad/s). */
        rate: Object.freeze([15, 20]),
        /** Seconds to come out of the crown and to go into one. */
        grow: 0.45,
        settle: 0.6,
        /** Clear of the ground by at least this (u) all the way. */
        clear: 7,
    }),
    /** The forest's sway under the gust: added share of the wind, its rise and its dying (s). */
    gust: Object.freeze({ gain: 0.9, rise: 0.4, fall: 4.5 }),
});

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + ((b - a) * t);
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smooth = (e0, e1, x) => {
    const k = clamp01((x - e0) / (e1 - e0));
    return k * k * (3 - (2 * k));
};
/** A small seeded generator (mulberry32): the wake is the same every run. */
const rngOf = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

// Downwind (the turning shade's heading) and across it.
const HX = ODYSSEY_DAY_TURN.heading[0];
const HZ = ODYSSEY_DAY_TURN.heading[1];
const PX = -HZ;
const PZ = HX;

/** Whether a tree at world (x, z) is near enough to be part of the wake (the renderer's filter). */
export function inTurnWakeReach(x, z, cfg = ODYSSEY_TURN_WAKE) {
    return x >= cfg.reach.x[0] && x <= cfg.reach.x[1] && z >= cfg.reach.z[0] && z <= cfg.reach.z[1];
}

/**
 * Whether a species lets leaves go in the wake: the shore's broadleaf (S1-) and the blossom (S7-).
 * The pines, firs and cypresses keep their needles.
 * @param {string} speciesId
 */
export function turnWakeSheds(speciesId) {
    return typeof speciesId === 'string' && (speciesId.startsWith('S1-') || speciesId.startsWith('S7-'));
}

/** Where a leaf is `age` seconds after it let go (the vertex stage's twin). */
export function turnWakeLeafAt(leaf, age, cfg = ODYSSEY_TURN_WAKE) {
    const L = cfg.leaves;
    const a = Math.min(Math.max(age, 0), leaf.life);
    const run = (leaf.burst * L.ease * (1 - Math.exp(-a / L.ease))) + (leaf.drift * a);
    const rise = (leaf.lift * (1 - Math.exp(-a / L.loft))) - (leaf.fall * a);
    const k = Math.min(a, 1);
    const sway = Math.sin((a * lerp(1.7, 3.0, leaf.s1)) + (leaf.s2 * TAU)) * lerp(L.sway[0], L.sway[1], leaf.s2) * k;
    const bob = Math.sin((a * 2.3) + (leaf.s1 * 9)) * L.bob * k;
    return {
        x: leaf.x + (HX * run) + (PX * sway),
        y: leaf.y + rise + bob,
        z: leaf.z + (HZ * run) + (PZ * sway),
    };
}

/** Where a bird is `age` seconds after it lifted (the vertex stage's twin). */
export function turnWakeBirdAt(bird, age, cfg = ODYSSEY_TURN_WAKE) {
    const B = cfg.birds;
    const u = clamp01(age / bird.life);
    const e = u * u * (3 - (2 * u));
    const arc = 4 * u * (1 - u);
    const wheel = Math.sin((u * TAU * B.turns) + (bird.s1 * TAU)) * arc * lerp(B.wheel[0], B.wheel[1], bird.s2);
    return {
        x: lerp(bird.x, bird.tx, e) + (PX * wheel),
        y: lerp(bird.y, bird.ty, e) + (arc * bird.rise),
        z: lerp(bird.z, bird.tz, e) + (PZ * wheel),
    };
}

/** How much of a leaf or bird there is (0..1 of its size) `age` seconds after it let go. */
export function turnWakeShownAt(item, age, cfg = ODYSSEY_TURN_WAKE) {
    const k = item.bird ? cfg.birds : cfg.leaves;
    return smooth(0, k.grow, age) * (1 - smooth(item.life - k.settle, item.life, age));
}

/** The forest's added sway `since` seconds after a gust was let go (0 before it). */
export function turnWakeGustAt(since, cfg = ODYSSEY_TURN_WAKE) {
    if (!(since > 0)) return 0;
    const G = cfg.gust;
    return G.gain * Math.min(since / G.rise, 1) * Math.exp(-Math.max(since - G.rise, 0) / G.fall);
}

/**
 * Who answers, from where to where (pure): the leaves and the birds of one wake.
 * @param {Array<{x:number, y:number, z:number, top:number, broad:boolean}>} trees the forest's
 *   trees in reach (`y` the foot, `top` the crown's top, `broad` a broadleaf)
 * @param {(x:number, z:number) => number} heightAt the island's height
 * @param {{leaves?: number}} [opts] the leaf count (the tier decides)
 */
export function planTurnWake(trees, heightAt, opts = {}, cfg = ODYSSEY_TURN_WAKE) {
    const { leaves = cfg.leaves.count } = opts;
    const L = cfg.leaves;
    const B = cfg.birds;
    const rng = rngOf(0x51ed270b);
    const far = (t) => Math.hypot(t.x - cfg.focus[0], t.z - cfg.focus[1]);
    const stand = trees.filter((t) => (t.top - t.y) > 4 && inTurnWakeReach(t.x, t.z, cfg));
    const broad = stand.filter((t) => t.broad).sort((a, b) => far(a) - far(b)).slice(0, cfg.trees);
    const out = { leaves: [], birds: [] };
    if (!broad.length) return out;

    const nLeaves = Math.max(0, Math.round(leaves));
    for (let i = 0; i < nLeaves; i += 1) {
        const tree = broad[i % broad.length];
        const h = tree.top - tree.y;
        // A point of the crown's upper shell.
        const az = rng() * TAU;
        const up = lerp(-0.2, 0.9, rng());
        const flat = Math.sqrt(Math.max(1 - (up * up), 0));
        const r = h * 0.26 * lerp(0.6, 1.0, rng());
        const leaf = {
            bird: false,
            x: tree.x + (Math.cos(az) * flat * r),
            y: tree.y + (h * 0.62) + (up * r),
            z: tree.z + (Math.sin(az) * flat * r),
            wait: (rng() ** 1.4) * L.stagger,
            burst: lerp(L.burst[0], L.burst[1], rng()),
            drift: lerp(L.drift[0], L.drift[1], rng()),
            lift: lerp(L.lift[0], L.lift[1], rng() ** 2),
            fall: lerp(L.fall[0], L.fall[1], rng()),
            s1: rng(),
            s2: rng(),
            life: L.maxLife,
        };
        // Its landing: the first moment its path meets the grass.
        for (let a = 0.6; a < L.maxLife; a += 0.1) {
            const at = turnWakeLeafAt(leaf, a, cfg);
            if (at.y <= heightAt(at.x, at.z) + L.land) {
                leaf.life = a;
                break;
            }
        }
        out.leaves.push(leaf);
    }

    // The birds' parties: seeds spread through the stand (the nearest tree, then each time the
    // tree farthest from the seeds so far), each party in the crowns round its seed.
    const crown = (t, share) => t.y + ((t.top - t.y) * share);
    const nearest = (list, x, z, n) => list
        .map((t) => ({ t, d: Math.hypot(t.x - x, t.z - z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map((entry) => entry.t);
    const core = broad.slice(0, cfg.core);
    const seeds = [core[0]];
    while (seeds.length < Math.min(B.parties, core.length)) {
        let best = null;
        let bestD = -1;
        core.forEach((t) => {
            const d = Math.min(...seeds.map((s) => Math.hypot(t.x - s.x, t.z - s.z)));
            if (d > bestD) {
                bestD = d;
                best = t;
            }
        });
        seeds.push(best);
    }
    seeds.forEach((seed, party) => {
        const from = nearest(broad, seed.x, seed.z, 4);
        const turn = (seeds.length > 1 ? ((party / (seeds.length - 1)) - 0.5) : 0) * 2 * B.fan;
        const hx = (HX * Math.cos(turn)) - (HZ * Math.sin(turn));
        const hz = (HX * Math.sin(turn)) + (HZ * Math.cos(turn));
        const hop = lerp(B.hop[0], B.hop[1], rng());
        const to = nearest(stand, seed.x + (hx * hop), seed.z + (hz * hop), 4);
        for (let k = 0; k < B.each; k += 1) {
            const a = from[k % from.length];
            const b = to[k % to.length];
            const bird = {
                bird: true,
                x: a.x + lerp(-1.2, 1.2, rng()),
                y: crown(a, lerp(0.58, 0.76, rng())),
                z: a.z + lerp(-1.2, 1.2, rng()),
                tx: b.x + lerp(-1.2, 1.2, rng()),
                ty: crown(b, lerp(0.58, 0.76, rng())),
                tz: b.z + lerp(-1.2, 1.2, rng()),
                wait: (party * B.partyGap) + (rng() * B.stagger),
                rise: lerp(B.rise[0], B.rise[1], rng()),
                life: lerp(B.life[0], B.life[1], rng()),
                s1: rng(),
                s2: rng(),
            };
            // Over the land all the way: the arc is raised until the whole flight clears it.
            for (let tries = 0; tries < 8; tries += 1) {
                let low = Infinity;
                for (let s = 1; s < 16; s += 1) {
                    const at = turnWakeBirdAt(bird, (s / 16) * bird.life, cfg);
                    // (Within a crown's height of either end the bird is in its tree.)
                    const arc = 4 * (s / 16) * (1 - (s / 16));
                    low = Math.min(low, (at.y - heightAt(at.x, at.z)) + ((1 - arc) * B.clear));
                }
                if (low >= B.clear) break;
                bird.rise += 8;
            }
            out.birds.push(bird);
        }
    });
    return out;
}

/**
 * @param {object} p
 * @param {Array<object>} p.trees      the forest's trees in reach (see planTurnWake)
 * @param {(x:number, z:number) => number} p.heightAt
 * @param {object} p.time              float node: the world's clock
 * @param {number} [p.leaves]          leaf count (the tier decides)
 * @param {Array<Array<number>>} p.tints  the leaves' colours (linear rgb), four of them
 * @param {(xz: object) => {sun: object, direct: object}} [p.lightAt]  the land's light at a place:
 *   the sun's colour there and how much of it is direct (the drifting and the turning shade)
 * @param {object} p.skyColour         vec3 node: the shade's sky light
 * @param {(colour: object, at: object) => object} p.toOutput  the world's haze and output stage
 * @returns {null | {mesh: object, plan: object, update: Function, dispose: Function}} null when no
 *   broadleaf tree stands in reach
 */
export function createOdysseyTurnWake({
    trees, heightAt, time, leaves, tints, lightAt = null, skyColour, toOutput,
}, cfg = ODYSSEY_TURN_WAKE) {
    const plan = planTurnWake(trees, heightAt, { leaves: leaves ?? cfg.leaves.count }, cfg);
    const items = [...plan.leaves, ...plan.birds];
    if (!items.length) return null;
    const L = cfg.leaves;
    const B = cfg.birds;

    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.instanceCount = items.length;
    // aHome: where it sat (xyz) and how long it waits after the gust (s).
    // aGo: a leaf's throw, breeze, lift and sinking; a bird's landing place (xyz) and arc height.
    // aMeta: seconds in the air, kind (0 leaf, 1 bird), two seeds.
    const aHome = new Float32Array(items.length * 4);
    const aGo = new Float32Array(items.length * 4);
    const aMeta = new Float32Array(items.length * 4);
    items.forEach((it, i) => {
        aHome.set([it.x, it.y, it.z, it.wait], i * 4);
        aGo.set(it.bird ? [it.tx, it.ty, it.tz, it.rise] : [it.burst, it.drift, it.lift, it.fall], i * 4);
        aMeta.set([it.life, it.bird ? 1 : 0, it.s1, it.s2], i * 4);
    });
    geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(aHome, 4));
    geometry.setAttribute('aGo', new THREE.InstancedBufferAttribute(aGo, 4));
    geometry.setAttribute('aMeta', new THREE.InstancedBufferAttribute(aMeta, 4));

    /** (the clock when the gust was let go, the rail's x and z then, unused). */
    const uWake = uniform(new THREE.Vector4(1e9, 0, 0, 0));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyTurnWake';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.alphaTest = 0.5;
    // x kind, y the bird's wing (-1 down .. 1 up), z a seed
    const vMeta = varying(vec3(0.0), 'twMeta');
    const vTint = varying(vec3(0.0), 'twTint');
    const vLight = varying(vec3(0.0), 'twLight');
    const vAt = varying(vec3(0.0), 'twAt');
    material.vertexNode = Fn(() => {
        const home = attribute('aHome', 'vec4');
        const go = attribute('aGo', 'vec4');
        const meta = attribute('aMeta', 'vec4');
        const life = meta.x;
        const birdF = select(meta.y.greaterThan(0.5), float(1), float(0)).toVar();
        const s1 = meta.z;
        const s2 = meta.w;
        // Seconds since the gust reached this one's tree and it let go.
        const age = time.sub(uWake.x)
            .sub(length(home.xz.sub(uWake.yz)).div(cfg.gustSpeed))
            .sub(home.w)
            .toVar();
        const a = clamp(age, 0, life).toVar();

        // ── a leaf: thrown downwind, lifted, then sinking, swaying across the wind ──
        const run = float(1).sub(exp(a.div(-L.ease))).mul(go.x.mul(L.ease)).add(go.y.mul(a));
        const rise = float(1).sub(exp(a.div(-L.loft))).mul(go.z).sub(go.w.mul(a));
        const settle = min(a, float(1));
        const sway = sin(a.mul(mix(float(1.7), float(3.0), s1)).add(s2.mul(TAU)))
            .mul(mix(float(L.sway[0]), float(L.sway[1]), s2))
            .mul(settle);
        const bob = sin(a.mul(2.3).add(s1.mul(9.0))).mul(L.bob).mul(settle);
        const leafAt = home.xyz.add(vec3(
            run.mul(HX).add(sway.mul(PX)),
            rise.add(bob),
            run.mul(HZ).add(sway.mul(PZ)),
        ));
        // ── a bird: out of its crown, over the forest on an arc with one wheel, into another ──
        const u = a.div(life).toVar();
        const ease = u.mul(u).mul(float(3).sub(u.mul(2)));
        const arc = u.mul(float(1).sub(u)).mul(4).toVar();
        const wheelPhase = u.mul(TAU * B.turns).add(s1.mul(TAU)).toVar();
        const wheel = sin(wheelPhase).mul(arc).mul(mix(float(B.wheel[0]), float(B.wheel[1]), s2));
        const birdAt = mix(home.xyz, go.xyz, ease).add(vec3(wheel.mul(PX), arc.mul(go.w), wheel.mul(PZ)));
        const centre = mix(leafAt, birdAt, birdF).toVar();

        // ── how much of it: it grows out of the crown and ends in the grass or a crown ──
        const growS = mix(float(L.grow), float(B.grow), birdF);
        const settleS = mix(float(L.settle), float(B.settle), birdF);
        const shown = smoothstep(float(0), growS, age)
            .mul(float(1).sub(smoothstep(life.sub(settleS), life, age)))
            .toVar();

        // ── its shape on screen ──
        // A leaf tumbles: it turns in the view plane and its width follows the flip. A bird banks
        // with its wheel and beats its wings (the fragment draws them at the beat's angle).
        const flip = cos(a.mul(mix(float(3.0), float(7.0), s2)).add(s1.mul(50.0))).toVar();
        const spin = a.mul(mix(float(1.6), float(4.2), s1)).add(s2.mul(30.0));
        const roll = mix(spin, cos(wheelPhase).mul(0.4), birdF);
        const width = mix(max(abs(flip), float(0.16)).mul(0.6), float(1), birdF);
        const local = vec2(positionGeometry.x.mul(width), positionGeometry.y.mul(mix(float(1), float(0.8), birdF)));
        const c = cos(roll);
        const s = sin(roll);
        const turned = vec2(local.x.mul(c).sub(local.y.mul(s)), local.x.mul(s).add(local.y.mul(c)));
        const size = mix(
            mix(float(L.size[0]), float(L.size[1]), s1),
            mix(float(B.size[0]), float(B.size[1]), s2),
            birdF,
        ).mul(shown);
        // (`centre` is in the world's own frame: through the world group's matrix to the scene.)
        const view = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(centre, 1.0)));
        const lifted = view.add(vec4(turned.mul(size.mul(2.0)), 0.0, 0.0));

        // ── its light and colour ──
        const land = lightAt ? lightAt(centre.xz) : { sun: vec3(1.0, 0.93, 0.80), direct: float(1) };
        // A leaf catches the sun by how squarely it faces it (never black: it glows through);
        // a small dark bird takes a little of it on its back.
        const facing = mix(abs(flip).mul(0.45).add(0.55), float(0.5), birdF).mul(land.direct);
        vLight.assign(mix(skyColour.mul(0.62), land.sun.mul(1.12), facing));
        const pick = s2.mul(4);
        const leafTint = mix(
            mix(vec3(...tints[0]), vec3(...tints[1]), smoothstep(0.98, 1.02, pick)),
            mix(vec3(...tints[2]), vec3(...tints[3]), smoothstep(2.98, 3.02, pick)),
            smoothstep(1.98, 2.02, pick),
        );
        vTint.assign(mix(leafTint, vec3(0.105, 0.09, 0.085), birdF));
        const beat = sin(a.mul(mix(float(B.rate[0]), float(B.rate[1]), s2)).add(s1.mul(40.0)));
        vMeta.assign(vec3(birdF, beat, s1));
        vAt.assign(centre);
        return shown.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
    })();
    // The shapes, cut by the alpha test: a leaf is a pointed oval; a bird is two wings at the
    // beat's angle (thick at the shoulder, fine at the tip) either side of a small body.
    material.opacityNode = Fn(() => {
        const p = positionGeometry.xy.mul(2.0); // -1..1 over the quad
        const ax = abs(p.x);
        const half = float(1).sub(p.y.mul(p.y)).mul(0.92);
        const leafIn = float(1).sub(smoothstep(half.sub(0.08), half.add(0.08), ax));
        const wingY = vMeta.y.mul(ax).mul(0.72).mul(float(1).sub(ax.mul(0.3)));
        const thick = float(1).sub(ax).mul(0.21).add(0.045);
        const wings = float(1).sub(smoothstep(thick.sub(0.03), thick.add(0.03), abs(p.y.sub(wingY))))
            .mul(float(1).sub(smoothstep(0.9, 0.98, ax)));
        const body = float(1).sub(smoothstep(0.8, 1.0, length(vec2(p.x.div(0.17), p.y.add(0.03).div(0.30)))));
        return mix(leafIn, max(wings, body), vMeta.x);
    })();
    material.colorNode = Fn(() => {
        const p = positionGeometry.xy.mul(2.0);
        // A leaf: its midrib a little deeper.
        const rib = mix(float(0.84), float(1.0), smoothstep(0.03, 0.16, abs(p.x)));
        const albedo = vTint.mul(mix(rib, float(1), vMeta.x));
        return toOutput(albedo.mul(vLight), vAt);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-world-turn-wake';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = 5;
    mesh.visible = false;

    // The wake now: when it was let go, and when its last leaf is down.
    let letGo = -Infinity;
    let until = -Infinity;
    let lastSide = 0;
    const ox = ODYSSEY_DAY_TURN.origin[0];
    const oz = ODYSSEY_DAY_TURN.origin[1];

    return {
        mesh,
        plan,
        uniforms: { uWake },
        /**
         * @param {number} time     the world's clock (s)
         * @param {number} front    where the shade's leading edge stands (odyssey-day-turn.js)
         * @param {boolean} sweeping whether the shade is crossing the land this frame
         * @param {number} x        the rail's ground track, world x
         * @param {number} z        ... and z
         * @param {boolean} shown   whether the world lets it draw
         * @returns {number} the forest's added sway under the gust (0 at rest)
         */
        update(now, front, sweeping, x, z, shown = true) {
            // Which side of the shade's edge the rail is on; a change while the shade crosses is
            // the edge passing overhead.
            const side = sweeping ? Math.sign(front - (((x - ox) * HX) + ((z - oz) * HZ))) : 0;
            if (now < letGo) {
                // (The clock went back: a new board.)
                letGo = -Infinity;
                until = -Infinity;
            }
            const here = Math.hypot(x - cfg.focus[0], z - cfg.focus[1]) < cfg.near;
            if (here && side !== 0 && lastSide !== 0 && side !== lastSide && now >= until) {
                letGo = now;
                let last = 0;
                items.forEach((it) => {
                    last = Math.max(last, (Math.hypot(it.x - x, it.z - z) / cfg.gustSpeed) + it.wait + it.life);
                });
                until = now + last + 0.25;
                uWake.value.set(now, x, z, 0);
                mesh.userData.letGo = now;
            }
            lastSide = side;
            mesh.visible = !!shown && now < until;
            return turnWakeGustAt(now - letGo, cfg);
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
        },
    };
}
