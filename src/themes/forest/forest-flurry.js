/**
 * Forest — what the wood throws into the air besides fireflies.
 *
 * The fireflies answer every event; six events also have an instrument of their own, each a
 * different thing of the wood in a colour of its own, so no two great moments look alike:
 *
 *   dewfall    a long hard drop shakes the boughs: dew comes down through the moonlight in
 *              silver streaks (it only shines where the moon finds it)
 *   bloom      two lines: the wood stars give up their light, white motes lifting off every
 *              flower in a ring that widens from the foot of the board
 *   spores     three lines: every fungus in the wood breathes out its spores, foxfire teal,
 *              cluster after cluster as the wave reaches them
 *   wisps      a twist: two strands of blue will-o'-the-wisp wind up out of the ferns beside
 *              the board
 *   leaves     a new level: a wind carries leaves and seeds across the whole glade, turning
 *              in the moonlight as they go
 *   goldfall   a perfect clear: gold comes down through the whole air from the crowns
 *
 * and the fungi let a few spores go by themselves on a night for it (`trickle`).
 *
 * Nothing here is simulated. A particle is a record written once when it is thrown (where,
 * which way, when, for how long, what colour) and the vertex stage places it from the clock
 * alone, so a burst costs the CPU a few hundred floats and nothing after; a particle that has
 * lived its life folds to nothing. Records live in a ring: a new one takes the next slot whose
 * particle is spent, and when none is (a frenzy) it is the new one that is let go, so nothing in
 * flight ever blinks out.
 *
 * ForestReactions asks for bursts in board terms (`frame.flurries`); `play()` knows where the
 * board stands in the wood and throws them there.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cos, cross, dot, exp, float, length, max, mix, normalize, positionGeometry, pow,
    saturate, select, sin, smoothstep, step, uv, varyingProperty, vec3, vec4,
} from 'three/tsl';
import { FOREST_STAGE_DEPTH } from './forest-stage.js';

/** Floats a particle's record takes: start + birth, flight + life, kind + size + seed + one more, colour + moonlit. */
export const FOREST_FLURRY_STRIDE = 16;
/** How a particle moves, as the vertex stage reads it. */
export const FOREST_FLURRY_MOTION = Object.freeze({
    drop: 0, mote: 1, helix: 2, glide: 3,
});
/** How hard the dew falls (m/s²): lighter than life, so a drop can be followed down. */
const DEW_GRAVITY = 4.6;
/** How fast a ring of bloom or a wave of spores runs out over the floor (m/s). */
const BLOOM_SPEED = 9;
const SPORE_SPEED = 13;
/** The colours: dew holds the moon, petals are white, spores foxfire, wisps blue, leaves pale, gold gold. */
const COLOURS = Object.freeze({
    dew: [0.8, 0.98, 1.3],
    petal: [0.86, 0.94, 1.0],
    spore: [0.03, 0.95, 0.78],
    wisp: [0.16, 0.34, 1.05],
    leaf: [0.4, 0.5, 0.32],
    gold: [1.0, 0.72, 0.24],
});
/** The reference tier's ring (High's): a tier's bursts are scaled by its ring against this. */
export const FLURRY_REFERENCE = 2600;
/** A particle this near the lens is let go (it would be a pale plate over the card): fades from, to (metres). */
const LENS_CLEAR = [1.2, 3];
const TAU = Math.PI * 2;
const NAMES = Object.freeze(['iFlurryA', 'iFlurryB', 'iFlurryC', 'iFlurryD']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class ForestFlurry {
    /**
     * `sources` are where the wood's own things stand, each a flat xyz list: `caps` (the fungi),
     * `flowers` (the wood stars) and `boughs` (points on the lower boughs of the near trees).
     */
    constructor({
        light, tier, rng = Math.random, groundHeight = () => 0, sources = {},
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.caps = sources.caps || new Float32Array(0);
        this.flowers = sources.flowers || new Float32Array(0);
        this.boughs = sources.boughs || new Float32Array(0);
        this.group = new THREE.Group();
        this.group.name = 'ForestFlurry';
        this.owned = [];
        this.time = 0;
        this.serial = -1;
        this.epoch = null;
        this.trickleDue = 0;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        this.seen = { x: 0, y: 0 };
        /** Thrown and let go since the world began (a frenzy lets go, never cuts). */
        this.stats = { thrown: 0, refused: 0 };
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? clamp(value, 0, 0.999999) : 0.5;
    }

    build() {
        const capacity = Math.max(0, Math.floor(this.tier.flurry || 0));
        if (!capacity) return this;
        const plane = new THREE.PlaneGeometry(1, 1);
        this.owned.push(plane);
        this.capacity = capacity;
        this.data = new Float32Array(capacity * FOREST_FLURRY_STRIDE);
        // One interleaved instance buffer: four attributes for the price of one vertex buffer.
        this.buffer = new THREE.InstancedInterleavedBuffer(this.data, FOREST_FLURRY_STRIDE);
        this.buffer.setUsage(THREE.DynamicDrawUsage);
        this.ends = new Float64Array(capacity).fill(-Infinity);
        this.cursor = 0;
        this.dirty = false;
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = plane.index;
        geometry.setAttribute('position', plane.getAttribute('position'));
        geometry.setAttribute('uv', plane.getAttribute('uv'));
        NAMES.forEach((name, k) => {
            geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, 4, k * 4));
        });
        geometry.instanceCount = capacity;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, -20), 400);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'ForestFlurry';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 42;
        // Nothing in flight, nothing drawn (see `flush`).
        mesh.visible = false;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'ForestFlurry';
        const A = attribute('iFlurryA', 'vec4'); // start, birth
        const B = attribute('iFlurryB', 'vec4'); // flight (a helix: turn rate, climb, radius), life
        const C = attribute('iFlurryC', 'vec4'); // motion, size, seed, one more (rise, or how a helix widens)
        const D = attribute('iFlurryD', 'vec4'); // colour, how much of its light is the moon's
        const vLook = varyingProperty('vec4', 'vForestFlurryLook'); // colour, presence
        const vStreak = varyingProperty('float', 'vForestFlurryStreak');
        material.positionNode = Fn(() => {
            const t = light.uTime;
            const age = t.sub(A.w).toVar();
            const life = max(B.w, 0.01).toVar();
            const share = saturate(age.div(life)).toVar();
            const motion = C.x;
            const seed = C.z;
            const drop = step(motion, 0.5).toVar();
            const helix = step(1.5, motion).mul(step(motion, 2.5)).toVar();
            const glide = step(2.5, motion).toVar();
            // A drop: let go, and gravity's.
            const dropAt = A.xyz.add(B.xyz.mul(age)).add(vec3(0, age.mul(age).mul(-0.5 * DEW_GRAVITY), 0));
            const dropFlight = B.xyz.add(vec3(0, age.mul(-DEW_GRAVITY), 0));
            // A wisp: round its axis, climbing, its circle widening.
            const angle = seed.mul(TAU).add(B.x.mul(age)).toVar();
            const radius = B.z.add(C.w.mul(age)).toVar();
            const helixAt = A.xyz.add(vec3(cos(angle).mul(radius), B.y.mul(age), sin(angle).mul(radius)));
            const helixFlight = vec3(sin(angle).mul(radius).mul(B.x).negate(), B.y, cos(angle).mul(radius).mul(B.x));
            // A mote (a spore, a petal of light, falling gold): its first push spent against the
            // air, then the wind's and its own slow wandering, rising or sinking as it will.
            const pushed = float(1).sub(exp(age.mul(-1.4))).div(1.4);
            const wind = vec3(light.uWindDir.x, 0, light.uWindDir.z)
                .mul(light.uWind.add(light.uGust).mul(age).mul(0.7));
            const wander = vec3(
                sin(age.mul(0.9).add(seed.mul(40))).mul(0.3),
                sin(age.mul(0.7).add(seed.mul(71))).mul(0.16),
                cos(age.mul(0.8).add(seed.mul(53))).mul(0.3),
            );
            const moteAt = A.xyz.add(B.xyz.mul(pushed)).add(wind).add(wander).add(vec3(0, age.mul(C.w), 0));
            // A leaf on the wind: carried at its pace, tumbling about its way.
            const tumble = vec3(
                sin(age.mul(2.6).add(seed.mul(40))).mul(0.34),
                sin(age.mul(3.7).add(seed.mul(71))).mul(0.22),
                cos(age.mul(2.1).add(seed.mul(53))).mul(0.34),
            );
            const glideAt = A.xyz.add(B.xyz.mul(age)).add(tumble).add(vec3(0, age.mul(C.w), 0));
            const at = select(
                drop.greaterThan(0.5),
                dropAt,
                select(helix.greaterThan(0.5), helixAt, select(glide.greaterThan(0.5), glideAt, moteAt)),
            ).toVar();
            const still = vec3(0, 0.001, 0);
            const flight = select(
                drop.greaterThan(0.5),
                dropFlight,
                select(helix.greaterThan(0.5), helixFlight, select(glide.greaterThan(0.5), B.xyz, still)),
            ).toVar();
            const alive = step(0, age).mul(step(age, life)).toVar();
            // A mote swells in and thins out; a drop and a wisp are simply there, and go.
            const breath = smoothstep(0, 0.14, share).mul(smoothstep(1, 0.62, share));
            const quick = smoothstep(0, 0.04, share).mul(smoothstep(1, 0.8, share));
            const present = mix(breath, quick, max(drop, helix)).mul(alive).toVar();
            // Face the eye, the quad's long side laid along the flight (the fireflies' way).
            const offset = cameraPosition.sub(at).toVar();
            const range = length(offset).toVar();
            const toEye = offset.div(range.max(0.001)).toVar();
            // A strand of wisps thins toward its top, where its lights are oldest. A far one is kept
            // a few pixels wide (and no brighter), so it never flickers in and out between pixels.
            const size = C.y.add(range.mul(0.0024)).mul(present).mul(helix.mul(share).mul(-0.5).add(1));
            const speed = length(flight);
            const streak = saturate(speed.mul(0.16)).mul(drop.add(helix.mul(0.8)).add(glide.mul(0.55))).toVar();
            const along = normalize(flight.sub(toEye.mul(dot(flight, toEye))).add(vec3(0, 0.00001, 0)));
            const across = normalize(cross(along, toEye));
            // Its light: its own, or the moon's (dew and leaves only shine where they stand between
            // the eye and the moon, and a clouded moon lights nothing).
            const moonward = saturate(dot(toEye.negate(), light.uMoonDir));
            const moonlit = pow(moonward, 2).mul(2.2).add(0.3).mul(light.uMoonGain);
            // Each turns, or trembles, on a clock of its own: a leaf shows its pale side and loses it.
            const wink = pow(saturate(sin(t.mul(seed.mul(5).add(3)).add(seed.mul(60))).mul(0.5).add(0.5)), 2);
            const twinkle = mix(wink.mul(0.5).add(0.6), wink.mul(1.5).add(0.12), glide);
            const clear = saturate(range.sub(LENS_CLEAR[0]).div(LENS_CLEAR[1] - LENS_CLEAR[0]));
            vLook.assign(vec4(D.rgb.mul(mix(float(1), moonlit, D.w)).mul(twinkle), present.mul(clear)));
            vStreak.assign(streak);
            // (A falling drop is a fine streak; a wisp a light with a tail; a leaf barely draws out.)
            const drawn = streak.mul(drop.mul(2.2).add(3.2)).add(1);
            const thin = streak.mul(drop.mul(-0.3).sub(0.35)).add(1);
            return at.add(along.mul(positionGeometry.y.mul(size).mul(drawn)))
                .add(across.mul(positionGeometry.x.mul(size).mul(thin)));
        })();
        const st = uv();
        const reach = length(st.sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(reach)), 3);
        const halo = exp(reach.mul(-4.2)).mul(saturate(float(1).sub(reach)));
        // (Clamped: with MSAA an edge pixel's centre can lie off the quad, and a power of a negative base is NaN.)
        const comet = mix(float(1), pow(max(st.y, 0), 1.6).mul(0.8).add(0.2), vStreak);
        material.colorNode = vLook.rgb.mul(1.8);
        material.opacityNode = core.mul(1.1).add(halo.mul(0.7)).mul(vLook.a).mul(comet);
        return material;
    }

    /**
     * Write a record into the next spent slot; false when every slot is still in flight, or when the
     * record is not sound (a non-finite number would reach the vertex stage, and one NaN vertex
     * spreads through the bloom).
     */
    write(birth, life, values) {
        if (!this.data || !Number.isFinite(birth) || !(life > 0) || !Number.isFinite(life)) return false;
        for (let i = 0; i < values.length; i += 1) if (!Number.isFinite(values[i])) return false;
        let slot = -1;
        for (let hop = 0; hop < this.capacity; hop += 1) {
            const index = (this.cursor + hop) % this.capacity;
            if (this.ends[index] <= this.time) {
                slot = index;
                break;
            }
        }
        if (slot < 0) {
            // Every slot is in flight: the new one is let go.
            this.stats.refused += 1;
            return false;
        }
        this.cursor = (slot + 1) % this.capacity;
        this.ends[slot] = birth + life;
        this.data.set(values, slot * FOREST_FLURRY_STRIDE);
        this.dirty = true;
        this.stats.thrown += 1;
        this.last = Math.max(this.last ?? -Infinity, birth + life);
        return true;
    }

    /**
     * Throw one particle: `motion` drop, mote or glide, from a place with a first flight, to live
     * `life` seconds from `delay` seconds on; `more` is how fast a mote rises (or sinks);
     * `moonlit` 0..1 how much of its light is the moon's rather than its own.
     */
    toss(motion, colour, x, y, z, vx, vy, vz, life, size, {
        more = 0, delay = 0, moonlit = 0,
    } = {}) {
        const sound = [x, y, z, vx, vy, vz, life, size, more].every(Number.isFinite) && life > 0;
        if (!sound) return false;
        const birth = this.time + (delay > 0 && Number.isFinite(delay) ? delay : 0);
        return this.write(birth, life, [
            x, y, z, birth, vx, vy, vz, life,
            FOREST_FLURRY_MOTION[motion] ?? FOREST_FLURRY_MOTION.mote, size, this.random(), more,
            colour[0], colour[1], colour[2], moonlit,
        ]);
    }

    /**
     * A tier's bursts against the reference tier's (High). The ring holds well over what one great
     * moment throws (a four-line clear's spores and bloom), so the moment that crowns it (a perfect
     * clear's falling gold, in the same second) finds room and is not turned away.
     */
    scale() {
        return clamp((this.capacity || 0) / FLURRY_REFERENCE, 0.2, 1.4);
    }

    /** Where on the floor behind the board an event happened. */
    origin(cue, stage) {
        const column = Number.isFinite(cue.column) ? cue.column : 0.5;
        return stage.floor(column, Number.isFinite(cue.row) ? cue.row : 0.1, this.foot);
    }

    /**
     * A long hard drop shakes the boughs: dew comes down through the moonlight, off the boughs
     * the eye can see and out of those over its head.
     */
    dewfall(cue, stage) {
        const { boughs } = this;
        const sites = Math.floor(boughs.length / 3);
        const strength = clamp(cue.strength, 0.2, 1);
        // (The lightest of the instruments: it comes with nearly every piece, and must never be a curtain.)
        const count = Math.round((40 + 85 * strength) * this.scale());
        for (let i = 0; i < count; i += 1) {
            let x;
            let y;
            let z;
            if (sites && this.random() < 0.5) {
                const pick = Math.floor(this.random() * sites) * 3;
                x = boughs[pick] + (this.random() - 0.5) * 1.6;
                z = boughs[pick + 2] + (this.random() - 0.5) * 1.6;
                y = boughs[pick + 1] - this.random() * 0.5;
            } else {
                // Out of the boughs overhead: it comes into the frame from its top.
                const depth = 5 + this.random() ** 1.4 * 24;
                ({ x, y, z } = stage.point(this.random(), -0.12 + this.random() * 0.3, depth, this.point));
            }
            const height = y - this.groundHeight(x, z);
            if (!(height > 0.6)) continue;
            // (It lives as long as its fall: it is gone where it meets the moss.)
            const fall = Math.sqrt((2 * height) / DEW_GRAVITY);
            this.toss(
                'drop',
                COLOURS.dew,
                x,
                y,
                z,
                (this.random() - 0.5) * 0.3,
                -0.1 - this.random() * 0.5,
                (this.random() - 0.5) * 0.3,
                Math.min(fall, 3.4),
                0.03 + this.random() * 0.04,
                { delay: this.random() * 0.55, moonlit: 1 },
            );
        }
    }

    /**
     * Two lines: the wood stars give up their light. White motes lift off the flowers in a ring
     * that widens from the floor behind the board; the flowers themselves flare as it passes
     * (the light rig's bloom ring, started here).
     */
    bloom(cue, stage) {
        const { flowers } = this;
        const spots = Math.floor(flowers.length / 3);
        const strength = clamp(cue.strength, 0.2, 1.5);
        const origin = this.origin(cue, stage);
        this.light.bloom?.(origin.x, origin.z, strength, BLOOM_SPEED);
        if (!spots) return;
        const wanted = Math.round(300 * Math.min(1, strength) * this.scale());
        const stride = Math.max(1, Math.floor(spots / wanted));
        const first = Math.floor(this.random() * stride);
        const reach = 14 + 16 * Math.min(1, strength);
        for (let i = first; i < spots; i += stride) {
            const x = flowers[i * 3];
            const y = flowers[i * 3 + 1];
            const z = flowers[i * 3 + 2];
            const away = Math.hypot(x - origin.x, z - origin.z);
            if (away > reach) continue;
            this.toss(
                'mote',
                COLOURS.petal,
                x,
                y + 0.05,
                z,
                (this.random() - 0.5) * 0.5,
                0.5 + this.random() * 0.9,
                (this.random() - 0.5) * 0.5,
                1.5 + this.random() * 1.5,
                0.06 + this.random() * 0.05,
                { more: 0.3 + this.random() * 0.35, delay: away / BLOOM_SPEED + this.random() * 0.12 },
            );
        }
    }

    /** One cluster's breath of spores, `delay` seconds on. */
    puff(x, y, z, count, delay, strength = 1) {
        for (let i = 0; i < count; i += 1) {
            const turn = this.random() * TAU;
            const out = 0.15 + this.random() * 0.55;
            this.toss(
                'mote',
                COLOURS.spore,
                x + (this.random() - 0.5) * 0.12,
                y + 0.1,
                z + (this.random() - 0.5) * 0.12,
                Math.cos(turn) * out,
                (0.8 + this.random() * 1.3) * (0.7 + 0.3 * strength),
                Math.sin(turn) * out,
                2.4 + this.random() * 2.4,
                0.06 + this.random() * 0.06,
                { more: 0.22 + this.random() * 0.3, delay: delay + this.random() * 0.35 },
            );
        }
    }

    /**
     * Three lines: every fungus in the wood breathes out its spores, cluster after cluster as the
     * wave from the board reaches them.
     */
    spores(cue, stage) {
        const { caps } = this;
        const count = Math.floor(caps.length / 3);
        if (!count) return;
        const strength = clamp(cue.strength, 0.2, 1.5);
        const origin = this.origin(cue, stage);
        const each = Math.max(1, Math.round(4 * Math.min(1.2, strength) * this.scale()));
        for (let i = 0; i < count; i += 1) {
            const x = caps[i * 3];
            const z = caps[i * 3 + 2];
            this.puff(x, caps[i * 3 + 1], z, each, Math.hypot(x - origin.x, z - origin.z) / SPORE_SPEED, strength);
        }
        // And the moss itself, where the foxfire runs through it: spores lift off the whole floor
        // on both sides of the board, so the wood's cold light is seen wherever the eye is.
        const lifted = Math.round(320 * Math.min(1, strength) * this.scale());
        for (let i = 0; i < lifted; i += 1) {
            const spot = stage.floor(-1.9 + this.random() * 4.8, this.random() ** 1.3 * 0.7, this.foot);
            this.toss(
                'mote',
                COLOURS.spore,
                spot.x,
                spot.y + 0.1,
                spot.z,
                (this.random() - 0.5) * 0.4,
                0.5 + this.random() * 1.1,
                (this.random() - 0.5) * 0.4,
                2.6 + this.random() * 2.6,
                0.06 + this.random() * 0.05,
                {
                    more: 0.3 + this.random() * 0.4,
                    delay: Math.hypot(spot.x - origin.x, spot.z - origin.z) / SPORE_SPEED + this.random() * 0.4,
                },
            );
        }
    }

    /**
     * A twist winds three strands of will-o'-the-wisp up out of the ferns beside the board: few
     * lights to a strand and well apart, so each is a light with its tail, not a drawn line.
     */
    wisps(cue, stage) {
        const side = cue.side < 0 ? -1 : 1;
        const edge = stage.edge(side, 0, FOREST_STAGE_DEPTH, this.point, 0);
        const x = edge.x + side * 1.5;
        const z = edge.z - 0.5;
        const floor = this.groundHeight(x, z);
        const strands = 3;
        const each = Math.max(4, Math.round(9 * this.scale()));
        const life = 2.3;
        for (let strand = 0; strand < strands; strand += 1) {
            for (let i = 0; i < each; i += 1) {
                // One after another, so the strands draw themselves upward as they turn.
                const birth = this.time + (i / each) * 1.1;
                this.write(birth, life, [
                    x, floor + 0.2, z, birth,
                    // turn rate (the way the piece turned), climb, the circle's first radius
                    side * 3.6, 2.4, 0.55, life,
                    FOREST_FLURRY_MOTION.helix, 0.2 + this.random() * 0.1, strand / strands, 0.45,
                    COLOURS.wisp[0], COLOURS.wisp[1], COLOURS.wisp[2], 0,
                ]);
            }
        }
    }

    /** A new level: a wind carries leaves and seeds across the whole glade. */
    leaves(cue, stage, wind = { x: 1, z: 0 }) {
        const strength = clamp(cue.strength, 0.2, 1.5);
        const count = Math.round(380 * Math.min(1, strength) * this.scale());
        const span = Math.hypot(wind.x, wind.z) || 1;
        const wx = wind.x / span;
        const wz = wind.z / span;
        for (let i = 0; i < count; i += 1) {
            // Somewhere in the air the eye can see, nearer more often than far; each starts
            // upwind of there and is carried through it.
            const depth = 7 + this.random() ** 1.4 * 34;
            const at = stage.point(this.random(), 0.1 + this.random() * 0.75, depth, this.point);
            const pace = 4.5 + this.random() * 4.5;
            const life = 2.6 + this.random() * 2.2;
            const lead = pace * life * (0.25 + this.random() * 0.5);
            const x = at.x - wx * lead;
            const z = at.z - wz * lead;
            const floor = this.groundHeight(x, z);
            this.toss(
                'glide',
                COLOURS.leaf,
                x,
                Math.max(floor + 0.4, at.y + 0.6),
                z,
                wx * pace,
                (this.random() - 0.5) * 0.4,
                wz * pace,
                life,
                0.03 + this.random() * 0.035,
                // (They come across with the front of the wind, not all at once.)
                { more: -0.22 - this.random() * 0.3, delay: this.random() * 1.6, moonlit: 0.75 },
            );
        }
    }

    /** A perfect clear lets gold fall through the whole air: off the boughs, and out of the dark above. */
    goldfall(cue, stage) {
        const { boughs } = this;
        const sites = Math.floor(boughs.length / 3);
        const strength = clamp(cue.strength, 0.3, 1.5);
        const count = Math.round(420 * Math.min(1, strength) * this.scale());
        for (let i = 0; i < count; i += 1) {
            let x;
            let y;
            let z;
            if (sites && this.random() < 0.55) {
                const pick = Math.floor(this.random() * sites) * 3;
                x = boughs[pick] + (this.random() - 0.5) * 2.4;
                y = boughs[pick + 1] + (this.random() - 0.5) * 1.5;
                z = boughs[pick + 2] + (this.random() - 0.5) * 2.4;
            } else {
                const depth = 5 + this.random() ** 1.5 * 34;
                const at = stage.point(this.random(), this.random() * 0.8 - 0.05, depth, this.point);
                ({ x, y, z } = at);
            }
            const floor = this.groundHeight(x, z);
            this.toss(
                'mote',
                COLOURS.gold,
                x,
                Math.max(floor + 0.7, y),
                z,
                (this.random() - 0.5) * 0.5,
                -0.15,
                (this.random() - 0.5) * 0.5,
                4 + this.random() * 3.4,
                0.06 + this.random() * 0.08,
                { more: -0.42 - this.random() * 0.34, delay: this.random() * 1.8 },
            );
        }
    }

    /**
     * The fungi let a few spores go by themselves: `rate` bursts a second across the wood (the
     * air's `spores`), each one cluster's breath.
     */
    trickle(dt, rate) {
        const count = Math.floor(this.caps.length / 3);
        if (!this.data || !count || !(rate > 0) || !(dt > 0)) return;
        this.trickleDue += dt * rate;
        // (Never more than a couple a frame, whatever the step.)
        for (let n = 0; this.trickleDue >= 1 && n < 2; n += 1) {
            this.trickleDue -= 1;
            const pick = Math.floor(this.random() * count) * 3;
            const breath = Math.max(2, Math.round(5 * this.scale()));
            this.puff(this.caps[pick], this.caps[pick + 1], this.caps[pick + 2], breath, 0, 0.6);
        }
        this.trickleDue = Math.min(this.trickleDue, 2);
    }

    /**
     * After a great clear the owl carries the gold on its wings: a wake of falling motes behind a
     * point in flight, `rate` of them a second (call it before `play`, which hands them to the GPU).
     */
    wake(x, y, z, dt, rate = 36) {
        if (!this.data || !(dt > 0) || ![x, y, z].every(Number.isFinite)) return;
        this.wakeDue = Math.min(4, (this.wakeDue || 0) + dt * rate * this.scale());
        while (this.wakeDue >= 1) {
            this.wakeDue -= 1;
            this.toss(
                'mote',
                COLOURS.gold,
                x + (this.random() - 0.5) * 0.9,
                y + (this.random() - 0.5) * 0.5,
                z + (this.random() - 0.5) * 0.9,
                (this.random() - 0.5) * 0.6,
                -0.1,
                (this.random() - 0.5) * 0.6,
                1.4 + this.random() * 1.2,
                0.05 + this.random() * 0.05,
                { more: -0.3 - this.random() * 0.25 },
            );
        }
    }

    /**
     * Throw what the director has asked for since the last frame (`frame.flurries`, a queue read
     * by serial; `frame.epoch` says when the director itself started over), and let the fungi
     * breathe (`air.spores`).
     */
    play(frame, {
        time, dt = 0, stage, wind = null, air = null,
    } = {}) {
        this.time = Number.isFinite(time) ? time : this.time;
        if (frame?.epoch !== this.epoch) {
            this.epoch = frame?.epoch;
            this.serial = -1;
        }
        const queue = Array.isArray(frame?.flurries) ? frame.flurries : [];
        for (let pass = 0; pass < queue.length; pass += 1) {
            let next = null;
            for (let i = 0; i < queue.length; i += 1) {
                const entry = queue[i];
                if (entry && entry.serial > this.serial && (!next || entry.serial < next.serial)) next = entry;
            }
            if (!next) break;
            this.serial = next.serial;
            if (!stage || !(next.strength > 0)) continue;
            if (next.kind === 'dew') this.dewfall(next, stage);
            else if (next.kind === 'bloom') this.bloom(next, stage);
            else if (next.kind === 'spores') this.spores(next, stage);
            else if (next.kind === 'wisps') this.wisps(next, stage);
            else if (next.kind === 'leaves') this.leaves(next, stage, wind || undefined);
            else if (next.kind === 'goldfall') this.goldfall(next, stage);
        }
        if (frame?.settled !== true) this.trickle(dt, Number.isFinite(air?.spores) ? air.spores : 0);
        this.flush();
    }

    /** Hand the GPU whatever was written this frame; draw nothing while nothing is in flight. */
    flush() {
        if (!this.buffer) return;
        if (this.dirty) {
            this.buffer.needsUpdate = true;
            this.dirty = false;
        }
        if (this.mesh) this.mesh.visible = (this.last ?? -Infinity) > this.time;
    }

    /** How many particles are in flight at the flurry's clock. */
    counts() {
        let particles = 0;
        if (this.ends) {
            for (let i = 0; i < this.capacity; i += 1) if (this.ends[i] > this.time) particles += 1;
        }
        return { particles, ...this.stats };
    }

    /** Forget everything in flight (a new session, the effects setting off, a seek). */
    reset() {
        if (!this.data) return;
        this.data.fill(0);
        this.ends.fill(-Infinity);
        this.cursor = 0;
        this.last = -Infinity;
        this.trickleDue = 0;
        this.wakeDue = 0;
        this.dirty = true;
        this.flush();
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.data = null;
        this.buffer = null;
        this.mesh = null;
    }
}
