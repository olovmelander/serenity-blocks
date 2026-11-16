/**
 * Voltage Storm — lightning.
 *
 * Every bolt is one instance of the same ribbon mesh: a main channel, branches that leave it and
 * twigs that leave the branches. Nothing about a bolt's shape is stored: the vertex stage builds it
 * from the slot's two end points, a seed and a STYLE (`BOLT_STYLE` in the core), so the same mesh
 * is a forked strike from the cloud, a giant with hardly a fork on it, spider lightning crawling
 * wide under the vault, the tree a tower sends up into the cloud, a smooth thread of plasma in a
 * piece's colour, an arc that stands between two tower tops and climbs like a Jacob's ladder, a
 * helix wound round a mast, or a web skittering over the water. Each bolt also draws its own lot
 * of limbs (which of them show, where they leave the channel, how long they are), so no two forks
 * are alike. Its light in time (a leader stepping down, return strokes running up the channel,
 * branches that flash once, a continuing current, the channel cooling into beads) is worked out on
 * the CPU once per frame and written into the slot's row.
 *
 * The table is the storm's only source of light: the brightest of the frame's bolts are copied
 * into the flash table that the cloud, the water, the towers and the rain read. That light is not
 * the channel's flicker: it swells and falls slowly (`strokeGlow` in the core), so the storm glows
 * with its lightning and never strobes.
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
    cross,
    exp,
    float,
    floor,
    instanceIndex,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    select,
    sin,
    smoothstep,
    step,
    varyingProperty,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BOLT_KIND,
    BOLT_RANGES,
    BOLT_ROWS,
    BOLT_SLOTS,
    BOLT_STYLE,
    FLASH_SLOTS,
    TAU,
    mulberry32,
    strokeGlow,
    strokeLife,
    strokeLight,
    strokePlan,
    vsFxMaterial,
    vsHash11,
    vsHash12,
} from './voltage-storm-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

// ── Geometry ────────────────────────────────────────────────────────────────────

/** What a bolt is drawn with at each detail level. */
export const BOLT_DETAIL = Object.freeze([
    Object.freeze({
        main: 44, branches: 5, branchSegments: 14, twigs: 0, twigSegments: 0,
    }),
    Object.freeze({
        main: 64, branches: 8, branchSegments: 20, twigs: 8, twigSegments: 8,
    }),
    Object.freeze({
        main: 88, branches: 10, branchSegments: 26, twigs: 14, twigSegments: 10,
    }),
]);

/**
 * The plan of the ribbon: its strips. Each strip is `segments` quads along a parameter u (0..1);
 * a branch leaves the main channel at `s0`, a twig leaves its branch at `u0`. (These are the
 * mesh's own places and lengths: every bolt shifts and scales them by its seed in the vertex
 * stage, and shows only its own share of them.)
 * Deterministic; exported for the tests.
 */
export function boltStrips(detail = 2) {
    const spec = BOLT_DETAIL[Math.max(0, Math.min(BOLT_DETAIL.length - 1, detail))];
    const rand = mulberry32(0xb017);
    const strips = [{
        depth: 0, segments: spec.main, s0: 0, length: 1, u0: 0, id: 0, parentId: 0, parentLength: 0,
    }];
    const branches = [];
    for (let j = 0; j < spec.branches; j++) {
        const s0 = 0.1 + (0.8 * (j + rand() * 0.8)) / spec.branches;
        const branch = {
            depth: 1,
            segments: spec.branchSegments,
            s0,
            // Longer where the channel is young: the big forks leave it high up.
            length: (0.16 + rand() * 0.3) * (1 - 0.5 * s0),
            u0: 0,
            id: 3 + j * 7,
            parentId: 0,
            parentLength: 0,
        };
        branches.push(branch);
        strips.push(branch);
    }
    for (let k = 0; k < spec.twigs; k++) {
        const parent = branches[k % branches.length];
        strips.push({
            depth: 2,
            segments: spec.twigSegments,
            s0: parent.s0,
            length: parent.length * (0.28 + rand() * 0.3),
            u0: 0.22 + rand() * 0.6,
            id: 101 + k * 5,
            parentId: parent.id,
            parentLength: parent.length,
        });
    }
    return strips;
}

/** The ribbon mesh for one bolt (instanced once per slot). */
export function boltGeometry(detail = 2) {
    const strips = boltStrips(detail);
    let vertexCount = 0;
    let quadCount = 0;
    strips.forEach((s) => {
        vertexCount += (s.segments + 1) * 2;
        quadCount += s.segments;
    });
    const position = new Float32Array(vertexCount * 3);
    const rib = new Float32Array(vertexCount * 4);
    const link = new Float32Array(vertexCount * 4);
    const parent = new Float32Array(vertexCount * 2);
    const index = new Uint16Array(quadCount * 6);
    let v = 0;
    let q = 0;
    strips.forEach((s) => {
        for (let i = 0; i <= s.segments; i++) {
            for (let side = -1; side <= 1; side += 2) {
                rib.set([i / s.segments, side, s.depth, s.id], v * 4);
                link.set([s.s0, s.length, s.u0, s.parentId], v * 4);
                parent.set([s.parentLength, 0], v * 2);
                if (i < s.segments && side === -1) {
                    index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
                    q += 1;
                }
                v += 1;
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aRib', new THREE.BufferAttribute(rib, 4));
    geometry.setAttribute('aLink', new THREE.BufferAttribute(link, 4));
    geometry.setAttribute('aParent', new THREE.BufferAttribute(parent, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.userData.strips = strips.length;
    geometry.userData.quads = quadCount;
    return geometry;
}

/** The share of a bolt's roughness a ribbon of each detail level can carry. */
const ROUGH_CAP = Object.freeze([0.5, 0.8, 1]);

// ── Shape (GPU) ─────────────────────────────────────────────────────────────────

/** Piecewise-straight noise in [−1, 1]²: random points on a lattice, joined by straight lines. */
const zig = /* @__PURE__ */ Fn(([x, seed]) => {
    const i = floor(x);
    const a = vsHash12(i.add(seed)).mul(2.0).sub(1.0);
    const b = vsHash12(i.add(seed).add(1.0)).mul(2.0).sub(1.0);
    return mix(a, b, x.sub(i));
}).setLayout({
    name: 'vs_zig',
    type: 'vec2',
    inputs: [{ name: 'x', type: 'float' }, { name: 'seed', type: 'float' }],
});

/**
 * A channel's wander at four scales: long legs, kinks, and the fine tremble on top. `rough` is how
 * much of the three finer scales it carries: 1 a strike (the small scales carry more than a
 * natural spectrum would give them: a bolt is nearly straight and everywhere jagged), near 0 a
 * thread of plasma that only sways.
 */
const tortuosity = /* @__PURE__ */ Fn(([x, seed, rough]) => zig(x.mul(2.7), seed)
    .add(zig(x.mul(7.9), seed.add(31.0)).mul(0.6)
        .add(zig(x.mul(21.3), seed.add(77.0)).mul(0.36))
        .add(zig(x.mul(55.0), seed.add(131.0)).mul(0.2))
        .mul(rough))).setLayout({
    name: 'vs_tortuosity',
    type: 'vec2',
    inputs: [{ name: 'x', type: 'float' }, { name: 'seed', type: 'float' }, { name: 'rough', type: 'float' }],
});

/**
 * @param {object} u  shared storm uniforms
 * @param {object} options
 * @param {number} options.detail   0..2
 * @param {boolean} options.mirror  draw the bolts' images in the water instead
 */
export function createBoltMesh(u, { detail = 2, mirror = false } = {}) {
    const geometry = boltGeometry(detail);
    const material = vsFxMaterial(mirror ? 'VoltageStormBoltMirror' : 'VoltageStormBolts');
    const rib = attribute('aRib', 'vec4');
    const link = attribute('aLink', 'vec4');
    const parent = attribute('aParent', 'vec2');

    const vAcross = varyingProperty('float', 'vsBoltAcross');
    /** (place along the whole bolt for the leader's growth, how far its core keeps its colour, _, _) */
    const vAlong = varyingProperty('vec4', 'vsBoltAlong');
    // A rib's seed, flat (its hashes break on the bits an interpolated copy is off by).
    const vRibSeed = flatVarying(float(0.0), 'vsBoltSeed');
    const vLight = varyingProperty('vec4', 'vsBoltLight');
    const vTint = varyingProperty('vec4', 'vsBoltTint');

    material.vertexNode = Fn(() => {
        const base = int(instanceIndex).mul(BOLT_ROWS);
        const A = u.bolts.element(base);
        const B = u.bolts.element(base.add(1));
        const C = u.bolts.element(base.add(2));
        const D = u.bolts.element(base.add(3));
        const E = u.bolts.element(base.add(4));
        const F = u.bolts.element(base.add(5));
        const G = u.bolts.element(base.add(6));
        const seed = A.w.toVar();
        const along = rib.x;
        const side = rib.y;
        const depth = rib.z;
        const isMain = float(1.0).sub(step(0.5, depth)).toVar();
        const isLimb = float(1.0).sub(isMain).toVar();
        const isTwig = step(1.5, depth).toVar();

        // ── This bolt's own lot of limbs ──
        // Where a branch leaves the channel and how long it is are the mesh's, shifted and scaled
        // by the bolt's seed; a twig rides on its branch's draw. And only a share of them show.
        const branchKey = mix(rib.w, link.w, isTwig);
        const branchDraw = vsHash12(branchKey.mul(1.91).add(seed.mul(0.731))).toVar();
        const ownDraw = vsHash12(rib.w.mul(1.91).add(seed.mul(0.731))).toVar();
        const s0 = clamp(link.x.add(branchDraw.x.sub(0.5).mul(0.22)), 0.03, 0.97).toVar();
        const branchScale = branchDraw.y.mul(1.0).add(0.45).mul(G.w).toVar();
        const ownScale = ownDraw.y.mul(1.0).add(0.45).mul(G.w).toVar();
        const shows = step(vsHash11(rib.w.mul(2.3).add(seed.mul(1.17))), E.y)
            .mul(mix(float(1.0), step(vsHash11(link.w.mul(2.3).add(seed.mul(1.17))), E.y), isTwig))
            .toVar();

        const span = B.xyz.sub(A.xyz).toVar();
        const reachLength = max(length(span), 0.01).toVar();
        const axis = span.div(reachLength).toVar();
        // A bolt wanders ACROSS the view, by a share of the angle it spans: a wander toward the
        // lens is invisible, and one measured in metres turns an arc that runs into the distance
        // into a tangle where it is near.
        const eye = cameraPosition;
        const sightA = normalize(A.xyz.sub(eye));
        const sightB = normalize(B.xyz.sub(eye));
        const spanAngle = max(length(cross(sightA, sightB)), 0.03).toVar();
        const sway = B.w.mul(spanAngle).toVar();
        const pinned = E.x;
        // (A coarser ribbon cannot draw the finest kinks: between two of its ribs they fold it over.)
        const rough = F.x.mul(ROUGH_CAP[Math.max(0, Math.min(ROUGH_CAP.length - 1, detail))]).toVar();
        // A pinned arc slides along its own wander (it writhes, it is not redrawn); an unpinned
        // bolt is shifted sideways whole (each return stroke a little off the last).
        const slide = F.z.mul(pinned).toVar();
        const shift = F.z.mul(float(1.0).sub(pinned)).mul(u.pixelAngle).toVar();
        /** Distance from the lens, and the two directions across the view, at a world point. */
        const frameAt = (point) => {
            const sight = point.sub(eye);
            const dist = max(length(sight), 0.5);
            const toward = sight.div(dist);
            const aside = normalize(cross(axis, toward).add(vec3(1e-4, 2e-4, 0.0)));
            const ahead = normalize(axis.sub(toward.mul(axis.dot(toward))).add(vec3(0.0, -1e-4, 1e-4)));
            return {
                dist, aside, ahead, toward,
            };
        };

        /** A point of the main channel. */
        const channel = (s) => {
            const straight = A.xyz.add(span.mul(s));
            const frame = frameAt(straight);
            const n = tortuosity(s.add(slide), seed, rough);
            const endPin = float(1.0).sub(smoothstep(0.78, 1.0, s));
            const bothPin = smoothstep(0.0, 0.14, s).mul(endPin);
            const pin = mix(endPin, bothPin, pinned);
            // It arches (hot plasma rises): a share of its length at its middle.
            const arch = s.mul(float(1.0).sub(s)).mul(4.0).mul(F.y).mul(reachLength);
            // And it may wind round its own axis: a helix that narrows as it climbs.
            const turn = s.mul(G.y).mul(TAU).add(seed);
            const radius = G.x.mul(float(1.0).sub(s.mul(0.55))).mul(smoothstep(0.0, 0.08, s))
                .mul(float(1.0).sub(smoothstep(0.9, 1.0, s)));
            const round = cross(axis, frame.aside);
            return straight
                .add(frame.aside.mul(n.x.mul(sway).mul(pin).add(shift).mul(frame.dist)))
                .add(vec3(0.0, 1.0, 0.0).mul(arch))
                .add(frame.aside.mul(cos(turn)).add(round.mul(sin(turn))).mul(radius));
        };
        /** How far a limb (branch or twig) has gone from its `root` at `t` of its own length. */
        const limb = (t, id, lengthFraction, rootPoint) => {
            const frame = frameAt(rootPoint);
            const h = vsHash12(id.add(seed.mul(1.37)));
            const turn = G.z.mul(h.x.mul(0.9).add(0.55));
            const hand = select(h.y.greaterThan(0.5), float(1.0), float(-1.0));
            const way = normalize(frame.ahead.mul(turn.cos()).add(frame.aside.mul(hand).mul(turn.sin())));
            const reach = lengthFraction.mul(spanAngle).mul(frame.dist);
            const n = tortuosity(t.mul(1.9).add(id), seed.add(id), rough.max(0.4).mul(1.3));
            const loose = min(t.mul(5.0), 1.0);
            return way.mul(reach.mul(t)).add(frame.aside.mul(n.x.mul(reach).mul(0.13).mul(loose)));
        };

        const root = channel(mix(s0, along, isMain)).toVar();
        const stem = limb(link.z, link.w, parent.x.mul(branchScale), root).mul(isTwig).toVar();
        const limbRoot = root.add(stem).toVar();
        const step1 = float(0.012);
        const ownLength = link.y.mul(ownScale).toVar();
        const at = (t) => limbRoot.add(limb(t, rib.w, ownLength, limbRoot).mul(isLimb));
        const here = vec3(0.0).toVar();
        const before = vec3(0.0).toVar();
        const after = vec3(0.0).toVar();
        // The main channel moves with its own parameter; a limb's root stays put.
        const mainHere = channel(along);
        const mainBefore = channel(along.sub(step1));
        const mainAfter = channel(along.add(step1));
        here.assign(mix(at(along), mainHere, isMain));
        before.assign(mix(at(along.sub(step1)), mainBefore, isMain));
        after.assign(mix(at(along.add(step1)), mainAfter, isMain));
        // What is above the water has an image in it; what dips under it has none.
        const overWater = smoothstep(0.0, 2.5, here.y);

        if (mirror) {
            // The image in the water: upside down, shivering with the ripples.
            const wobble = (p) => vec3(
                p.x.add(sin(p.y.mul(0.21).add(u.time.mul(2.3))).mul(abs(p.y).mul(0.012).add(0.25))),
                p.y.negate(),
                p.z,
            );
            here.assign(wobble(here));
            before.assign(wobble(before));
            after.assign(wobble(after));
        }

        const viewProjection = cameraProjectionMatrix.mul(cameraViewMatrix);
        const clip = viewProjection.mul(vec4(here, 1.0)).toVar();
        const c0 = viewProjection.mul(vec4(before, 1.0));
        const c1 = viewProjection.mul(vec4(after, 1.0));
        const half = u.viewport.mul(0.5);
        const p0 = c0.xy.div(max(c0.w, 0.01)).mul(half);
        const p1 = c1.xy.div(max(c1.w, 0.01)).mul(half);
        const dir = normalize(p1.sub(p0).add(vec2(1e-4, 0.0)));
        const normal = vec2(dir.y.negate(), dir.x);

        // ── Light ──
        // Where a point lies in the bolt's growth: a limb sets out when the leader passes its root
        // and is done when the leader is.
        const branchPlace = (a) => s0.add(float(1.0).sub(s0).mul(a).mul(0.9));
        const twigRoot = branchPlace(link.z);
        const place = mix(
            mix(branchPlace(along), twigRoot.add(float(1.0).sub(twigRoot).mul(along).mul(0.9)), isTwig),
            along,
            isMain,
        );
        const grow = D.x;
        const leading = step(0.0005, grow).mul(float(1.0).sub(step(0.0005, D.y.add(D.w))));
        const limbShare = mix(float(1.0), shows, isLimb);
        const taper = mix(float(1.0).sub(along.mul(0.75)), float(1.0), isMain);
        // A branch carries a share of the channel's current and a twig under half of that: beside
        // a strike they are threads, in spider lightning they are the bolt.
        const rank = mix(float(1.0), F.w.mul(mix(float(1.0), float(0.45), isTwig)), isLimb);
        // (leader, channel, afterglow, _): the fragment adds the tip and the beads.
        const strokes = mix(D.z.mul(rank), D.y, isMain);
        const leaderRank = mix(float(1.0), mix(float(0.7), float(0.45), isTwig), isLimb);
        vLight.assign(vec4(
            leading.mul(leaderRank).mul(limbShare),
            strokes.mul(taper).mul(limbShare),
            D.w.mul(mix(F.w.mul(0.5), float(1.0), isMain)).mul(limbShare),
            grow,
        ));
        vAlong.assign(vec4(place, E.w, 0.0, 0.0));
        vRibSeed.assign(seed.add(rib.w));
        // The part of a bolt that is inside the cloud is a glow, not a line.
        const inCloud = smoothstep(E.z.sub(4.0), E.z.add(60.0), abs(here.y)).mul(step(1.0, E.z));
        const gain = mix(float(1.0), float(0.12), inCloud).mul(mirror ? overWater.mul(0.4) : 1.0);
        vTint.assign(vec4(C.xyz, gain));
        vAcross.assign(side);

        const live = step(0.0005, max(max(D.y, D.z), max(D.w, leading))).mul(max(isMain, shows));
        // Nearer bolts are thicker, but never as thick as their distance says.
        const near = clamp(float(170.0).div(max(clip.w, 1.0)), 1.0, 2.6).pow(0.55);
        // The ribbon is three times as wide as the core it carries: the rest is the halo.
        const thin = mix(float(1.0), mix(float(0.5), float(0.34), isTwig), isLimb);
        const widthPx = max(
            C.w.mul(3.0).mul(u.viewport.y.div(1080.0)).mul(near).mul(thin)
                .mul(taper.mul(0.5).add(0.5))
                .mul(mirror ? 1.6 : 1.0),
            2.6,
        ).mul(live);
        return vec4(clip.xy.add(normal.mul(side.mul(widthPx)).div(half).mul(clip.w)), clip.z, clip.w);
    })();

    material.colorNode = Fn(() => {
        const x = clamp(vAcross, -1.0, 1.0);
        const keeps = clamp(vAlong.y, 0.0, 1.0);
        // A hairline core, white-hot, in a halo of the bolt's own colour; plasma keeps its colour to
        // the core and carries a wider, softer halo.
        const core = exp(x.mul(x).mul(mix(float(-12.0), float(-7.0), keeps)));
        const skirt = exp(abs(x).mul(-3.6)).mul(mix(float(0.085), float(0.2), keeps))
            .mul(float(1.0).sub(smoothstep(0.7, 1.0, abs(x))));
        const place = vAlong.x;
        const grow = vLight.w;
        // The leader: a dim, trembling thread with a bright head that has come as far as `grow`.
        const reached = step(place, grow.mul(1.02));
        const head = exp(max(grow.sub(place), 0.0).mul(-34.0));
        const tremble = vsHash11(floor(u.time.mul(60.0)).add(vRibSeed).add(floor(place.mul(40.0)))).mul(0.5).add(0.5);
        const leader = vLight.x.mul(reached).mul(head.mul(12.0).add(tremble.mul(1.7)));
        // The channel cooling: it breaks into beads before it goes out.
        const beadNoise = vsHash11(floor(place.mul(46.0)).add(vRibSeed));
        const beads = smoothstep(0.25, 0.8, beadNoise).mul(0.8).add(0.2);
        const glow = vLight.z.mul(beads).mul(1.6);
        // Plasma is not even along its length: knots of light run along it.
        const knots = mix(float(1.0), sin(place.mul(31.0).sub(u.time.mul(9.0)).add(vRibSeed)).mul(0.22).add(0.86), keeps);
        const light = leader.add(vLight.y.mul(42.0).mul(knots)).add(glow).mul(vTint.w);
        const colour = mix(vTint.xyz, vec3(1.0, 0.98, 1.0), core.mul(mix(float(0.9), float(0.35), keeps)));
        return vec4(colour.mul(core.add(skirt)).mul(light).mul(u.breath.mul(0.25).add(0.75)), 0.0);
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, BOLT_SLOTS);
    mesh.name = material.name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = mirror ? 6 : 40;
    return { mesh, material, geometry };
}

// ── The table (CPU) ─────────────────────────────────────────────────────────────

const KIND_NAMES = Object.keys(BOLT_KIND);
/** Brightest first, by what a light delivers (its level times its gain). */
const byLight = (a, b) => b.level * b.gain - a.level * a.gain;
const newLight = () => ({
    x: 0, y: 0, z: 0, reach: 600, r: 1, g: 1, b: 1, gain: 0, level: 0,
});

/**
 * Owns the bolt slots: fires bolts into them, works out each one's light every frame and lists
 * the frame's lights for the flash table.
 */
export class BoltTable {
    /** @param {Array<{x:number,y:number,z:number,w:number}>} rows  BOLT_SLOTS × BOLT_ROWS vec4 rows */
    constructor(rows) {
        this.rows = rows;
        this.slots = Array.from({ length: BOLT_SLOTS }, () => ({
            live: false,
            kind: 0,
            birth: -100,
            plan: null,
            life: 0,
            gain: 1,
            held: false,
            reseed: 0,
            seed: 0,
            bow: 0,
            ribbon: 0,
            /** The light it throws where it is in the cloud (or at its middle)... */
            light: newLight(),
            /** ...and, for a strike, the light at its foot (the towers and the water round it). */
            foot: newLight(),
        }));
        this.cursors = {};
        KIND_NAMES.forEach((name) => {
            this.cursors[name] = 0;
        });
        this.lights = [];
        this._light = {};
        /**
         * The light of the frame's bolts that found no row in the flash table (dimmest first to
         * go): what they would have delivered, `k`, and its colour weighted by it. The world folds
         * it into the cloud's held glow instead of losing it when the sky is busy.
         */
        this.spill = {
            k: 0, r: 0, g: 0, b: 0,
        };
        this.fired = 0;
        /** Reduced motion: every bolt has one stroke and a standing arc holds a steady light. */
        this.calm = false;
        this.reset();
    }

    reset() {
        for (let i = 0; i < BOLT_SLOTS; i++) {
            const slot = this.slots[i];
            slot.live = false;
            slot.held = false;
            slot.birth = -100;
            for (let k = 0; k < BOLT_ROWS; k++) this.rows[i * BOLT_ROWS + k].set(0, 0, 0, 0);
        }
        KIND_NAMES.forEach((name) => {
            this.cursors[name] = 0;
        });
        this.lights.length = 0;
        this.fired = 0;
    }

    /**
     * Fire a bolt.
     * @param {object} bolt
     * @param {'strike'|'arc'|'chain'|'crawler'} bolt.kind  the pool it takes a slot from
     * @param {number[]} bolt.start   world point it leaves
     * @param {number[]} bolt.end     world point it reaches
     * @param {number[]} bolt.rgb     halo colour (scene-linear)
     * @param {number} bolt.time      when its leader starts (may be a moment ahead)
     * @param {object} [bolt.style]   how it is built (`BOLT_STYLE`; default: a forked strike)
     * @param {number} [bolt.seed]    shape seed (default: from the count of bolts fired)
     * @param {number} [bolt.reach]   sideways wander as a fraction of its length
     * @param {number} [bolt.width]   core half-width in px at 1080p
     * @param {number} [bolt.power]   gain on its light
     * @param {number} [bolt.leader]  seconds the leader takes
     * @param {number} [bolt.strokes] return strokes
     * @param {number} [bolt.gap]     the least time between two strokes (default 0.045 s)
     * @param {number} [bolt.spread]  how much longer a gap may be (default 0.075 s)
     * @param {number} [bolt.hold]    seconds of continuing current after the first stroke
     * @param {number} [bolt.ribbon]  px each return stroke is shifted sideways from the last
     * @param {number} [bolt.branches] gain on the share of its limbs that show (the style's `limbs`)
     * @param {number} [bolt.veil]    the height (metres) above which it is inside the cloud and
     *                                only a glow (0: never; default: none)
     * @param {number[]} [bolt.helix] [radius in metres, turns]: it winds round its own axis
     * @param {number} [bolt.glow]    reach in metres of the light it throws (0 = it lights nothing)
     * @param {number} [bolt.glowGain] gain on that light
     * @param {number} [bolt.glowAt]  where along it that light stands, 0 start .. 1 end
     * @param {number} [bolt.glowLift] metres that light is lifted (into the cloud over a strike)
     * @param {number} [bolt.footGlow] reach in metres of a second light at its end (0: none)
     * @param {number} [bolt.footGain] gain on that second light
     * @param {number} [bolt.index]   a fixed slot within the kind's range (chain arcs)
     * @param {number} [bolt.now]     the moment it is fired at (default: `time`): which slot is
     *                                free, or nearest its end, is judged then
     * @returns {number} the slot
     */
    fire({
        kind = 'strike', start, end, rgb, time, style = BOLT_STYLE.fork, seed, reach = 0.085, width = 3.2, power = 1,
        leader = 0.11, strokes = 3, gap, spread, hold = 0, ribbon = 0, branches = 1, veil = 0, helix = null,
        glow = 650, glowGain = 1, glowAt, glowLift = 0, footGlow = 0, footGain = 1, index = null, held = false, now,
    }) {
        const range = BOLT_RANGES[kind] || BOLT_RANGES.strike;
        const size = range[1] - range[0];
        let slotIndex;
        if (index !== null) slotIndex = range[0] + (Math.max(0, index) % size);
        else {
            const pool = BOLT_RANGES[kind] ? kind : 'strike';
            slotIndex = this.pick(range, this.cursors[pool], Number.isFinite(now) ? now : time);
            this.cursors[pool] = slotIndex - range[0] + 1;
        }
        this.fired += 1;
        const slot = this.slots[slotIndex];
        const shape = Number.isFinite(seed) ? seed : 1 + ((this.fired * 37) % 613);
        slot.live = true;
        slot.kind = BOLT_KIND[kind] ?? 0;
        slot.birth = time;
        slot.held = held === true;
        slot.gain = power;
        slot.seed = shape;
        slot.reseed = 0;
        slot.bow = style.bow || 0;
        slot.ribbon = this.calm ? 0 : ribbon;
        slot.plan = strokePlan(shape, {
            leader, strokes: this.calm ? 1 : strokes, power, gap, spread, hold,
        });
        slot.life = strokeLife(slot.plan);
        const pinned = slot.kind === BOLT_KIND.arc || slot.kind === BOLT_KIND.chain;
        const base = slotIndex * BOLT_ROWS;
        this.rows[base].set(start[0], start[1], start[2], shape);
        this.rows[base + 1].set(end[0], end[1], end[2], reach);
        this.rows[base + 2].set(rgb[0], rgb[1], rgb[2], width);
        this.rows[base + 3].set(0, 0, 0, 0);
        this.rows[base + 4].set(
            pinned ? 1 : 0,
            Math.max(0, Math.min(1, (style.limbs ?? 0.75) * branches)),
            Math.max(0, veil),
            style.coreTint || 0,
        );
        this.rows[base + 5].set(style.rough ?? 1, slot.bow, 0, style.limbRank ?? 0.16);
        this.rows[base + 6].set(helix ? helix[0] : 0, helix ? helix[1] : 0, style.limbTurn ?? 0.55, style.limbLength ?? 1);
        // Where its light is thrown from: a strike lights the cloud it leaves, from inside; an
        // arc, its middle.
        let k = slot.kind === BOLT_KIND.strike ? 0.04 : 0.5;
        if (Number.isFinite(glowAt)) k = glowAt;
        const { light, foot } = slot;
        light.x = start[0] + (end[0] - start[0]) * k;
        light.y = start[1] + (end[1] - start[1]) * k + glowLift;
        light.z = start[2] + (end[2] - start[2]) * k;
        light.reach = glow;
        light.r = rgb[0] * 0.75 + 0.25;
        light.g = rgb[1] * 0.75 + 0.25;
        light.b = rgb[2] * 0.75 + 0.25;
        light.gain = glow > 0 ? glowGain : 0;
        light.level = 0;
        foot.x = end[0];
        foot.y = end[1] + 12;
        foot.z = end[2];
        foot.reach = footGlow;
        foot.r = light.r;
        foot.g = light.g;
        foot.b = light.b;
        foot.gain = footGlow > 0 ? footGain : 0;
        foot.level = 0;
        return slotIndex;
    }

    /**
     * The slot a new bolt of a kind takes at `now`: the next free one from the kind's turn, else
     * the oldest still alight (the one furthest into its afterglow, never a standing arc). When
     * the sky is busy a new bolt so takes a slot that is done or nearly done instead of cutting
     * off whatever bolt the turn happens to land on, mid-stroke. Ties go by turn, so a table
     * fired all at once still fills one slot after another.
     */
    pick(range, cursor, now) {
        const size = range[1] - range[0];
        let best = -1;
        let oldest = Infinity;
        for (let j = 0; j < size; j++) {
            const i = range[0] + ((cursor + j) % size);
            const slot = this.slots[i];
            // Free: never used, emptied, or its life is over by now (whether or not a frame has
            // noticed yet: the choice must not depend on how the frames were cut).
            if (!slot.live || (!slot.held && now - slot.birth > slot.life)) return i;
            if (slot.held) continue;
            if (slot.birth < oldest) {
                oldest = slot.birth;
                best = i;
            }
        }
        return best >= 0 ? best : range[0] + (cursor % size);
    }

    /** Empty every slot of a kind at once (no afterglow). */
    clear(kind) {
        const range = BOLT_RANGES[kind];
        if (!range) return;
        for (let i = range[0]; i < range[1]; i++) {
            const slot = this.slots[i];
            slot.live = false;
            slot.held = false;
            this.rows[i * BOLT_ROWS + 3].set(0, 0, 0, 0);
        }
    }

    /** Let go of a held arc (a chain's standing arc): it cools from now. */
    release(kind, index, time) {
        const range = BOLT_RANGES[kind] || BOLT_RANGES.strike;
        const slot = this.slots[range[0] + (index % (range[1] - range[0]))];
        if (slot.live && slot.held) {
            slot.held = false;
            slot.birth = time - slot.plan.last;
        }
    }

    /** Re-colour a fixed slot of a kind (a standing arc follows the palette). */
    tint(kind, index, rgb) {
        const range = BOLT_RANGES[kind] || BOLT_RANGES.strike;
        const slotIndex = range[0] + (index % (range[1] - range[0]));
        const row = this.rows[slotIndex * BOLT_ROWS + 2];
        row.x = rgb[0];
        row.y = rgb[1];
        row.z = rgb[2];
        const { light } = this.slots[slotIndex];
        light.r = rgb[0] * 0.75 + 0.25;
        light.g = rgb[1] * 0.75 + 0.25;
        light.b = rgb[2] * 0.75 + 0.25;
    }

    /** Whether a fixed slot of a kind (a chain's standing arc) still has a bolt in it. */
    isLive(kind, index) {
        const range = BOLT_RANGES[kind] || BOLT_RANGES.strike;
        return this.slots[range[0] + (index % (range[1] - range[0]))].live;
    }

    /**
     * Work out every live bolt's light at `time` and write it to the table. Returns the lights of
     * the frame, brightest first (at most `limit`); what the rest would have delivered is summed
     * in `spill`.
     */
    update(time, limit = FLASH_SLOTS) {
        const { lights, spill } = this;
        lights.length = 0;
        spill.k = 0;
        spill.r = 0;
        spill.g = 0;
        spill.b = 0;
        const out = this._light;
        for (let i = 0; i < BOLT_SLOTS; i++) {
            const slot = this.slots[i];
            const row = this.rows[i * BOLT_ROWS + 3];
            if (!slot.live) continue;
            const age = time - slot.birth;
            if (!slot.held && age > slot.life) {
                slot.live = false;
                row.set(0, 0, 0, 0);
                continue;
            }
            const shape = this.rows[i * BOLT_ROWS + 5];
            if (slot.held && age >= 0) {
                // A standing arc is not redrawn: it writhes (its wander slides along it), it rises
                // as hot plasma does, and when it has stretched as far as it will it snaps, strikes
                // again low and starts to climb once more: a Jacob's ladder between two tower
                // tops. (Held still, at a steady light, under reduced motion.)
                const period = 1.15 + (i % 3) * 0.37;
                const climbs = this.calm ? 0 : Math.floor(age / period);
                const into = this.calm ? 0.5 : age / period - climbs;
                if (climbs !== slot.reseed) {
                    slot.reseed = climbs;
                    this.rows[i * BOLT_ROWS].w = slot.seed + (climbs % 97) * 3;
                }
                shape.y = slot.bow * (0.45 + 1.1 * into);
                shape.z = this.calm ? 0 : age * 0.9 + i;
                // Brightest as it strikes, thinning as it stretches.
                const snap = this.calm ? 0 : Math.exp(-(into * period) / 0.09);
                const shimmer = this.calm
                    ? 0.72
                    : 0.7 + 0.16 * Math.sin(age * 23 + i * 1.7) * Math.sin(age * 7.1 + i) - 0.22 * into;
                const rise = Math.min(1, age / 0.08);
                const level = slot.gain * (shimmer + snap * 0.9) * rise;
                row.set(1, level * 0.36, level * 0.3, 0);
                // (Its light on the storm is its steady glow: the snap is the arc's own.)
                slot.light.level = slot.gain * (this.calm ? 0.72 : 0.7 - 0.2 * into) * rise * 0.22;
            } else {
                strokeLight(slot.plan, age, out);
                row.set(out.grow, out.main, out.branch, out.after);
                // Ribbon lightning: each return stroke stands a little to the side of the last.
                if (slot.ribbon !== 0) shape.z = Math.max(0, out.stroke) * slot.ribbon;
                const glow = strokeGlow(slot.plan, age) + (out.grow > 0 && out.grow < 1 ? 0.035 : 0);
                slot.light.level = glow;
                slot.foot.level = glow;
            }
            if (slot.light.gain > 0 && slot.light.level > 0.004) lights.push(slot.light);
            if (!slot.held && slot.foot.gain > 0 && slot.foot.level > 0.004) lights.push(slot.foot);
        }
        lights.sort(byLight);
        const keep = Math.max(0, Math.min(FLASH_SLOTS, limit));
        for (let i = keep; i < lights.length; i++) {
            const light = lights[i];
            const k = light.level * light.gain;
            spill.k += k;
            spill.r += light.r * k;
            spill.g += light.g * k;
            spill.b += light.b * k;
        }
        if (lights.length > keep) lights.length = keep;
        return lights;
    }

    /** Bolts with anything left to show. */
    liveCount() {
        let n = 0;
        for (let i = 0; i < BOLT_SLOTS; i++) n += this.slots[i].live ? 1 : 0;
        return n;
    }
}
