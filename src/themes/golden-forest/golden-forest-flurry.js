/**
 * Golden Forest — what the lake throws into the air.
 *
 * Four of the events have a burst of their own, none of them fireflies:
 *   droplets   a hard drop strikes the lake: a crown of drops leaps beside the board, each on
 *              its own arc, catches the sun and falls back
 *   helix      a twist winds two strands of sparks up out of the water beside the board
 *   pollen     where the wind of a great clear goes through the spruces they breathe out their
 *              pollen: a soft golden cloud off each crown and a drift of motes downwind
 *   goldfall   a perfect clear lets gold fall through the whole air
 *
 * Nothing here is simulated. A particle is a record written once when it is thrown (where,
 * which way, when, for how long) and the vertex stage places it from the clock alone, so a
 * burst costs the CPU a few hundred floats and nothing after; a particle that has lived its
 * life folds to nothing. Records live in a ring: a new one takes the next slot whose particle
 * is spent, and when none is (a frenzy) it is the new one that is let go, so nothing in flight
 * ever blinks out. The clouds are a second small draw of the same kind.
 *
 * GoldenForestReactions asks for bursts in board terms (`frame.flurries`); `play()` knows where
 * the board stands over the water and throws them there.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cos, cross, dot, exp, float, length, max, mix, normalize, positionGeometry, pow,
    saturate, select, sin, smoothstep, step, uv, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { GOLDEN_FOREST_STAGE_DEPTH } from './golden-forest-stage.js';

/** Floats a particle's record takes: start + birth, flight + life, kind + size + seed + one more. */
export const FLURRY_STRIDE = 12;
/** The kinds, as the vertex stage reads them. */
export const FLURRY_KIND = Object.freeze({
    droplets: 0, pollen: 1, helix: 2, goldfall: 3,
});
/** How hard the drops fall (m/s²): a little lighter than life, so the crown can be read. */
const DROP_GRAVITY = 7.6;
/** Breaths of cloud a crown gives one after another, so its pollen streams as a plume. */
const POLLEN_BREATHS = 3;
/**
 * How far ahead the ring is searched for a spent particle at first. Past that the whole ring is
 * looked through before the new one is let go: a ring with room somewhere never refuses.
 */
const SEARCH = 64;
const TAU = Math.PI * 2;

const NAMES = Object.freeze(['iFlurryA', 'iFlurryB', 'iFlurryC']);
const PUFF_NAMES = Object.freeze(['iPuffA', 'iPuffB', 'iPuffC']);

/** A ring of records in one interleaved instance buffer, with each slot's last moment kept on the CPU. */
function createRing(capacity, names, plane) {
    const data = new Float32Array(capacity * FLURRY_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, FLURRY_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    geometry.setAttribute('uv', plane.getAttribute('uv'));
    names.forEach((name, k) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    geometry.instanceCount = capacity;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, -40), 400);
    return {
        capacity, data, buffer, geometry, ends: new Float64Array(capacity).fill(-Infinity), cursor: 0, dirty: false,
    };
}

/** Write a record into the next spent slot; false when every slot searched is still in flight. */
function writeRing(ring, now, birth, life, values) {
    let slot = -1;
    for (let hop = 0; hop < ring.capacity; hop += 1) {
        const index = (ring.cursor + hop) % ring.capacity;
        if (ring.ends[index] <= now) {
            slot = index;
            break;
        }
    }
    if (slot < 0) {
        // Every slot is in flight: the new one is let go. Start further along next time.
        // eslint-disable-next-line no-param-reassign
        ring.cursor = (ring.cursor + SEARCH) % ring.capacity;
        return false;
    }
    ring.cursor = (slot + 1) % ring.capacity;
    ring.ends[slot] = birth + life;
    ring.data.set(values, slot * FLURRY_STRIDE);
    // eslint-disable-next-line no-param-reassign
    ring.dirty = true;
    return true;
}

function clearRing(ring) {
    ring.data.fill(0);
    ring.ends.fill(-Infinity);
    // eslint-disable-next-line no-param-reassign
    ring.cursor = 0;
    // eslint-disable-next-line no-param-reassign
    ring.dirty = true;
}

export class GoldenForestFlurry {
    constructor({
        light, tier, rng = Math.random, groundHeight = () => -1,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestFlurry';
        this.owned = [];
        this.time = 0;
        this.serial = -1;
        this.epoch = null;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        /** Thrown and let go since the world began (a frenzy lets go, never cuts). */
        this.stats = { thrown: 0, refused: 0, breathed: 0 };
        /** Crown points the spruces breathe their pollen from (the world gives them once). */
        this.crowns = new Float32Array(0);
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    build() {
        const capacity = Math.max(0, Math.floor(this.tier.flurry || 0));
        if (!capacity) return this;
        const plane = new THREE.PlaneGeometry(1, 1);
        this.owned.push(plane);
        this.ring = createRing(capacity, NAMES, plane);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(this.ring.geometry, material);
        mesh.name = 'GoldenForestFlurry';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 42;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(this.ring.geometry, material);
        const clouds = Math.max(0, Math.floor(this.tier.puffs || 0));
        if (clouds) {
            this.puffs = createRing(clouds, PUFF_NAMES, plane);
            const puffMaterial = this.createPuffMaterial();
            const puffMesh = new THREE.Mesh(this.puffs.geometry, puffMaterial);
            puffMesh.name = 'GoldenForestPollenClouds';
            puffMesh.frustumCulled = false;
            puffMesh.matrixAutoUpdate = false;
            puffMesh.renderOrder = 28;
            this.puffMesh = puffMesh;
            this.group.add(puffMesh);
            this.owned.push(this.puffs.geometry, puffMaterial);
        }
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'GoldenForestFlurry';
        const A = attribute('iFlurryA', 'vec4'); // start, birth
        const B = attribute('iFlurryB', 'vec4'); // flight (a helix: turn rate, climb, radius), life
        const C = attribute('iFlurryC', 'vec4'); // kind, size, seed, one more (a helix: how its radius grows)
        const vLook = varyingProperty('vec4', 'vFlurryLook'); // colour, light
        const vStreak = varyingProperty('float', 'vFlurryStreak');
        material.positionNode = Fn(() => {
            const t = light.uTime;
            const age = t.sub(A.w).toVar();
            const life = max(B.w, 0.01).toVar();
            const share = saturate(age.div(life)).toVar();
            const kind = C.x;
            const seed = C.z;
            const drop = step(kind, 0.5).toVar();
            const helix = step(1.5, kind).mul(step(kind, 2.5)).toVar();
            const fall = step(2.5, kind).toVar();
            // A drop: thrown, and gravity's.
            const dropAt = A.xyz.add(B.xyz.mul(age)).add(vec3(0, age.mul(age).mul(-0.5 * DROP_GRAVITY), 0));
            const dropFlight = B.xyz.add(vec3(0, age.mul(-DROP_GRAVITY), 0));
            // A helix spark: round its axis, climbing, its circle widening.
            const angle = seed.mul(TAU).add(B.x.mul(age)).toVar();
            const radius = B.z.add(C.w.mul(age)).toVar();
            const helixAt = A.xyz.add(vec3(cos(angle).mul(radius), B.y.mul(age), sin(angle).mul(radius)));
            const helixFlight = vec3(sin(angle).mul(radius).mul(B.x).negate(), B.y, cos(angle).mul(radius).mul(B.x));
            // A mote (pollen, falling gold): its first push spent against the air, then the wind's
            // and its own slow wandering.
            const pushed = float(1).sub(exp(age.mul(-1.4))).div(1.4);
            const wind = vec3(light.uWindDir.x, 0, light.uWindDir.z)
                .mul(light.uWind.add(light.uGust).mul(age).mul(0.9));
            const wander = vec3(
                sin(age.mul(0.9).add(seed.mul(40))).mul(0.3),
                sin(age.mul(0.7).add(seed.mul(71))).mul(0.16),
                cos(age.mul(0.8).add(seed.mul(53))).mul(0.3),
            );
            const moteAt = A.xyz.add(B.xyz.mul(pushed)).add(wind.mul(fall.oneMinus())).add(wander)
                .add(vec3(0, age.mul(C.w), 0));
            const at = select(drop.greaterThan(0.5), dropAt, select(helix.greaterThan(0.5), helixAt, moteAt)).toVar();
            const still = vec3(0, 0.001, 0);
            const flight = select(drop.greaterThan(0.5), dropFlight, select(helix.greaterThan(0.5), helixFlight, still))
                .toVar();
            // In its life, and (a drop) still over the water it rose from.
            const alive = step(0, age).mul(step(age, life)).mul(mix(float(1), step(0, at.y), drop)).toVar();
            // A mote swells in and thins out; a drop and a spark are simply there, and go.
            const breath = smoothstep(0, 0.12, share).mul(smoothstep(1, 0.7, share));
            const quick = smoothstep(0, 0.03, share).mul(smoothstep(1, 0.82, share));
            const present = mix(breath, quick, max(drop, helix)).mul(alive).toVar();
            // A helix thins toward its top, where its sparks are oldest.
            const size = C.y.mul(present).mul(helix.mul(share).mul(-0.55).add(1));
            // Face the eye, the quad's long side laid along the flight (the fireflies' way).
            const toEye = normalize(cameraPosition.sub(at));
            const speed = length(flight);
            // (A drop is a bead: it barely draws out. A helix spark trails.)
            const streak = saturate(speed.mul(0.11)).mul(drop.mul(0.3).add(helix)).toVar();
            const along = normalize(flight.sub(toEye.mul(dot(flight, toEye))).add(vec3(0, 0.00001, 0)));
            const across = normalize(cross(along, toEye));
            // What it is made of: a drop is the sun in a bead of water, a helix spark pale gold, pollen
            // the dull gold of dust in a beam, falling gold a brighter mote that turns as it falls.
            const twinkle = pow(saturate(sin(t.mul(seed.mul(5).add(3)).add(seed.mul(60))).mul(0.5).add(0.5)), 3);
            // (A drop is cool white: it holds the sky, and so stands apart from the fireflies' amber.)
            const dropLook = vec4(light.uSunColor.mul(0.1).add(vec3(0.62, 0.7, 0.82)), twinkle.mul(0.9).add(0.6));
            const helixLook = vec4(1.0, 0.56, 0.14, share.oneMinus().mul(0.75).add(0.3));
            const pollenLook = vec4(light.uHazeWarm.mul(0.75).add(vec3(0.2, 0.13, 0.03)), twinkle.mul(0.3).add(0.3));
            const fallLook = vec4(light.uSunColor.mul(0.18).add(vec3(0.75, 0.5, 0.15)), twinkle.mul(1.1).add(0.22));
            const moteLook = mix(pollenLook, fallLook, fall);
            vLook.assign(select(drop.greaterThan(0.5), dropLook, select(helix.greaterThan(0.5), helixLook, moteLook))
                .mul(vec4(1, 1, 1, present)));
            vStreak.assign(streak);
            return at.add(along.mul(positionGeometry.y.mul(size).mul(streak.mul(2.4).add(1))))
                .add(across.mul(positionGeometry.x.mul(size).mul(streak.mul(-0.3).add(1))));
        })();
        const st = uv();
        const reach = length(st.sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(reach)), 3);
        const halo = exp(reach.mul(-4.2)).mul(saturate(float(1).sub(reach)));
        // (Clamped: with MSAA an edge pixel's centre can lie off the quad, and a power of a negative base is NaN.)
        const comet = mix(float(1), pow(max(st.y, 0), 1.6).mul(0.8).add(0.2), vStreak);
        material.colorNode = vLook.rgb.mul(1.6);
        material.opacityNode = core.mul(1.1).add(halo.mul(0.55)).mul(vLook.a).mul(comet);
        return material;
    }

    /** The pollen clouds: soft golden breaths off the crowns, lit from behind. */
    createPuffMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false,
        });
        material.name = 'GoldenForestPollenClouds';
        const A = attribute('iPuffA', 'vec4'); // start, birth
        const B = attribute('iPuffB', 'vec4'); // drift, life
        const C = attribute('iPuffC', 'vec4'); // size at first, how it grows, seed, how thick
        const vPuff = varyingProperty('vec4', 'vPuffLook'); // how thick now, seed, how sunward, age's share
        material.positionNode = Fn(() => {
            const age = light.uTime.sub(A.w).toVar();
            const life = max(B.w, 0.01);
            const share = saturate(age.div(life)).toVar();
            const alive = step(0, age).mul(step(age, life));
            const wind = vec3(light.uWindDir.x, 0, light.uWindDir.z)
                .mul(light.uWind.add(light.uGust).mul(age).mul(1.6));
            const at = A.xyz.add(B.xyz.mul(age)).add(wind).toVar();
            const size = C.x.add(C.y.mul(age)).mul(alive);
            const toEye = normalize(cameraPosition.sub(at)).toVar();
            const right = normalize(cross(vec3(0, 1, 0), toEye));
            const up = cross(toEye, right);
            // It swells out of the crown and thins away downwind.
            const thick = smoothstep(0, 0.16, share).mul(smoothstep(1, 0.35, share)).mul(C.w).mul(alive);
            const sunward = saturate(dot(toEye.negate(), light.uSunDir));
            vPuff.assign(vec4(thick, C.z, sunward, share));
            return at.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
        })();
        const st = uv();
        const centred = st.sub(0.5).mul(2);
        const reach = length(centred);
        // A cloud, not a disc: its edge is eaten by a noise that drifts through it as it ages, a
        // finer one curling its rim.
        const churn = vec2(vPuff.y.mul(7.3), vPuff.y.mul(3.1).add(vPuff.w.mul(0.3)));
        const eaten = light.noise(st.mul(0.5).add(churn)).g.mul(0.62)
            .add(light.noise(st.mul(1.35).sub(churn.mul(1.7))).b.mul(0.38));
        const body = saturate(float(1).sub(reach).mul(1.9).sub(eaten.mul(1.05))
            .add(0.12));
        // Pollen is sulphur gold, lit by the warm air and the sky; where the sun stands behind
        // the cloud it burns.
        const pollen = vec3(0.95, 0.74, 0.22);
        // (A veil, not a body: thin enough that the trees show through it, or it is a yellow blob.)
        material.colorNode = pollen.mul(light.uHazeWarm.mul(0.95).add(light.uSkyLight.mul(0.75)))
            .add(pollen.mul(light.uSunColor).mul(pow(vPuff.z, 3)).mul(0.22));
        material.opacityNode = smoothstep(0.0, 0.7, body).mul(vPuff.x).mul(0.3).min(0.32);
        return material;
    }

    /** Throw one particle (false: the ring is full of particles in flight, and this one is let go). */
    toss(kind, x, y, z, vx, vy, vz, life, size, more = 0, delay = 0) {
        const sound = [x, y, z, vx, vy, vz, life, size, more].every(Number.isFinite) && life > 0;
        if (!this.ring || !sound) return false;
        const birth = this.time + (delay > 0 && Number.isFinite(delay) ? delay : 0);
        const thrown = writeRing(this.ring, this.time, birth, life, [
            x, y, z, birth, vx, vy, vz, life, FLURRY_KIND[kind] ?? 0, size, this.random(), more,
        ]);
        if (thrown) this.stats.thrown += 1;
        else this.stats.refused += 1;
        return thrown;
    }

    /** Breathe one cloud out. */
    cloud(x, y, z, vx, vy, vz, life, size, growth, thick, delay = 0) {
        const sound = [x, y, z, vx, vy, vz, life, size, growth, thick].every(Number.isFinite) && life > 0;
        if (!this.puffs || !sound) return false;
        const birth = this.time + (delay > 0 && Number.isFinite(delay) ? delay : 0);
        const made = writeRing(this.puffs, this.time, birth, life, [
            x, y, z, birth, vx, vy, vz, life, size, growth, this.random(), thick,
        ]);
        if (made) this.stats.breathed += 1;
        return made;
    }

    /** A hard drop strikes the lake beside the board: a crown of drops. */
    droplets(flurry, stage, ripples) {
        const strength = Math.max(0.2, Math.min(1, flurry.strength));
        // On the side the piece came down; only the longest drops throw a few up on the other too.
        const sides = strength > 0.85 ? [flurry.side || -1, -(flurry.side || -1)] : [flurry.side || -1];
        sides.forEach((side, order) => {
            const edge = stage.edge(side, 0, GOLDEN_FOREST_STAGE_DEPTH, this.point, 0);
            const x0 = edge.x + side * 0.7;
            const z0 = edge.z - 0.4;
            if (this.groundHeight(x0, z0) >= 0) return;
            const share = order === 0 ? 1 : 0.45;
            const count = Math.round((8 + 24 * strength) * share * this.scale());
            for (let i = 0; i < count; i += 1) {
                const turn = this.random() * TAU;
                const out = 0.4 + this.random() * 1.9;
                const up = (3.4 + this.random() * 3.6) * (0.75 + 0.45 * strength);
                this.toss(
                    'droplets',
                    x0 + Math.cos(turn) * 0.35,
                    0.05,
                    z0 + Math.sin(turn) * 0.35,
                    Math.cos(turn) * out + side * (0.5 + this.random() * 1.2),
                    up,
                    Math.sin(turn) * out * 0.8,
                    (2 * up) / DROP_GRAVITY + 0.05,
                    0.07 + this.random() * 0.07,
                    0,
                    this.random() * 0.06,
                );
            }
            ripples?.add(x0, z0, (0.7 + 0.8 * strength) * share);
        });
    }

    /** A twist winds two strands of sparks up out of the water beside the board. */
    helix(flurry, stage) {
        const side = flurry.side < 0 ? -1 : 1;
        const edge = stage.edge(side, 0, GOLDEN_FOREST_STAGE_DEPTH, this.point, 0);
        const x0 = edge.x + side * 1.9;
        const z0 = edge.z - 0.6;
        const strands = 2;
        const each = Math.round(26 * this.scale());
        const climb = 3.1;
        for (let strand = 0; strand < strands; strand += 1) {
            for (let i = 0; i < each; i += 1) {
                // One after another, so the helix draws itself upward; `more` widens its circle.
                const delay = (i / each) * 0.75;
                this.throwHelix(x0, z0, side, strand / strands, delay, climb);
            }
        }
    }

    throwHelix(x, z, side, phase, delay, climb) {
        if (!this.ring) return false;
        const birth = this.time + delay;
        const life = 1.9;
        const thrown = writeRing(this.ring, this.time, birth, life, [
            x, 0.15, z, birth,
            // turn rate (the way the piece turned), climb, the circle's first radius
            side * 5.2, climb, 0.55, life,
            FLURRY_KIND.helix, 0.13, phase, 0.42,
        ]);
        if (thrown) this.stats.thrown += 1;
        else this.stats.refused += 1;
        return thrown;
    }

    /**
     * The spruces breathe out their pollen as the wind of a great clear goes through them: from
     * crowns the eye can see beside the board, each in turn the way the wind is going, a plume
     * of golden cloud (a few breaths one after another, so it streams) and motes drifting from it.
     */
    pollen(flurry, stage) {
        const { crowns } = this;
        const count = crowns.length / 3;
        if (!count || !stage) return;
        const strength = Math.max(0.3, Math.min(1.5, flurry.strength));
        // Which crowns stand in the frame, clear of the card.
        const seen = [];
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < count; i += 1) {
            const at = stage.project(crowns[i * 3], crowns[i * 3 + 1], crowns[i * 3 + 2], this.foot);
            const framed = at.z > 6 && at.x > 0.02 && at.x < 0.98 && at.y > 0.03 && at.y < 0.8;
            if (framed && !stage.covered(at.x, at.y, 0.02)) {
                seen.push(i);
                minX = Math.min(minX, at.x);
                maxX = Math.max(maxX, at.x);
            }
        }
        if (!seen.length) return;
        const breaths = POLLEN_BREATHS;
        const room = this.puffs ? Math.floor(this.puffs.capacity / breaths) : 4;
        const wanted = Math.max(1, Math.min(seen.length, Math.round(room * Math.min(1, strength))));
        const span = Math.max(0.05, maxX - minX);
        const first = Math.floor(this.random() * seen.length);
        const stride = Math.max(1, Math.floor(seen.length / wanted));
        const motes = Math.round(9 * this.scale());
        for (let n = 0; n < wanted; n += 1) {
            const index = seen[(first + n * stride) % seen.length] * 3;
            const x = crowns[index];
            const y = crowns[index + 1];
            const z = crowns[index + 2];
            // The wind crosses the frame from the left: the crowns breathe out as it reaches them.
            const sx = stage.project(x, y, z, this.foot).x;
            const delay = ((sx - minX) / span) * 1.4 + this.random() * 0.25;
            const drift = 1.5 + this.random() * 0.9;
            for (let breath = 0; breath < breaths; breath += 1) {
                this.cloud(
                    x + (this.random() - 0.5) * 0.8,
                    y + (this.random() - 0.3) * 0.9,
                    z + (this.random() - 0.5) * 0.8,
                    drift * (1 - breath * 0.08),
                    0.3 + this.random() * 0.35,
                    (this.random() - 0.5) * 0.5,
                    5 + this.random() * 2,
                    2.4 + this.random() * 1.5,
                    1.2 + this.random() * 0.7,
                    0.9 * Math.min(1, strength) * (1 - breath * 0.14),
                    delay + breath * 0.42,
                );
            }
            for (let i = 0; i < motes; i += 1) {
                this.toss(
                    'pollen',
                    x + (this.random() - 0.5) * 1.8,
                    y + (this.random() - 0.5) * 1.6,
                    z + (this.random() - 0.5) * 1.8,
                    1.5 + this.random() * 2.2,
                    (this.random() - 0.3) * 1.2,
                    (this.random() - 0.5) * 1.6,
                    3.4 + this.random() * 2.6,
                    0.07 + this.random() * 0.07,
                    -0.12 - this.random() * 0.14,
                    delay + this.random() * 1.2,
                );
            }
        }
    }

    /** A perfect clear lets gold fall through the whole air on either side of the board. */
    goldfall(flurry, stage) {
        const strength = Math.max(0.3, Math.min(1.5, flurry.strength));
        const count = Math.round(240 * Math.min(1, strength) * this.scale());
        for (let i = 0; i < count; i += 1) {
            // Somewhere in the air the eye can see, nearer more often than far, never behind the card's middle.
            const depth = 5 + this.random() ** 1.5 * 34;
            const sx = this.random();
            const sy = this.random() * 0.8 - 0.05;
            const at = stage.point(sx, sy, depth, this.point);
            const ground = Math.max(0, this.groundHeight(at.x, at.z));
            this.toss(
                'goldfall',
                at.x,
                Math.max(ground + 0.6, at.y),
                at.z,
                (this.random() - 0.5) * 0.5,
                -0.15,
                (this.random() - 0.5) * 0.5,
                4.2 + this.random() * 3.2,
                0.06 + this.random() * 0.08,
                -0.38 - this.random() * 0.3,
                this.random() * 1.6,
            );
        }
    }

    /** A tier's bursts against the reference tier's (High). */
    scale() {
        return Math.max(0.25, Math.min(1.4, (this.ring?.capacity || 0) / 1000));
    }

    /**
     * Throw what the director has asked for since the last frame (`frame.flurries`, a queue read
     * by serial; `frame.epoch` says when the director itself started over).
     */
    play(frame, {
        time, stage, ripples = null,
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
            if (next.kind === 'droplets') this.droplets(next, stage, ripples);
            else if (next.kind === 'helix') this.helix(next, stage);
            else if (next.kind === 'pollen') this.pollen(next, stage);
            else if (next.kind === 'goldfall') this.goldfall(next, stage);
        }
        this.flush();
    }

    /** Hand the GPU whatever was written this frame. */
    flush() {
        [this.ring, this.puffs].forEach((ring) => {
            if (ring?.dirty) {
                ring.buffer.needsUpdate = true;
                // eslint-disable-next-line no-param-reassign
                ring.dirty = false;
            }
        });
    }

    /** How many particles and clouds are in flight at the flurry's clock. */
    counts() {
        const live = (ring) => {
            if (!ring) return 0;
            let n = 0;
            for (let i = 0; i < ring.capacity; i += 1) if (ring.ends[i] > this.time) n += 1;
            return n;
        };
        return { particles: live(this.ring), clouds: live(this.puffs), ...this.stats };
    }

    /** Forget everything in flight (a new session, the effects setting off, a seek). */
    reset() {
        if (this.ring) clearRing(this.ring);
        if (this.puffs) clearRing(this.puffs);
        this.flush();
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.ring = null;
        this.puffs = null;
        this.mesh = null;
        this.puffMesh = null;
    }
}
