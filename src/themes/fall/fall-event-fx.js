/**
 * Fall — what the game's events throw into the air besides leaves.
 *
 *   maple keys   three lines and more shake them out of the crowns beside the board; a twist flings
 *                a spiral of them. A key is a winged seed: it spins round its own nut as it sinks.
 *   acorns       a long hard drop shakes a few loose: they fall, bounce once and lie.
 *   motes        gold dust that hangs in the air after a perfect clear, lit where the sun reaches.
 *   sparks       points of light caught in the combo's vortex, winding up round the board; a twist's
 *                ribbon of light is a curl of them drawn one after another.
 *   lanterns     a ring of small lights round the card's foot that gathers as a combo counts up.
 *
 * Nothing here is simulated. A particle is a record written once when it is thrown (where, which
 * way, when) and the vertex stage places it from the clock alone, so a burst costs the CPU a few
 * hundred floats and nothing after, and a seek lands on the same picture. Records live in rings: a
 * new one takes the next slot whose particle is spent, and when none is (a frenzy) it is the new
 * one that is let go, so nothing in flight ever blinks out. The lanterns are not thrown at all:
 * each lights when the count passes its own place in the ring.
 *
 * FallReactions asks in board terms (`frame.fx.cues`, read by serial, each once); `play()` knows
 * where the board stands in the grove (FallStage) and where the crowns are.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, clamp, color, cos, cross, dot, exp, float, length, max, mix, normalGeometry,
    normalize, positionGeometry, pow, saturate, select, sin, smoothstep, sqrt, step, uniform, uv, varyingProperty,
    vec2, vec3, vec4,
} from 'three/tsl';
import { fallEventTier } from './fall-event-light.js';
import { FALL_STAGE_DEPTH } from './fall-stage.js';

/** Floats a particle's record takes (three vec4 rows). */
export const FALL_FX_STRIDE = 12;
const TAU = Math.PI * 2;
/** How long a key lies where it landed before it is gone (seconds), and how fast it stops being thrown. */
export const KEY_REST = 1.6;
const KEY_DRAG = 2.2;
const KEY_SINK = 3;
/** How hard an acorn falls (m/s²: a little lighter than life, so the fall can be followed) and how long it lies. */
export const ACORN_GRAVITY = 8.5;
const ACORN_REST = 2.2;
/** How far ahead a ring is searched for a spent slot before the new particle is let go. */
const SEARCH = 48;
/** Where the lantern ring stands: how deep into the view its middle is, and how wide it is (m). */
const LANTERN_DEPTH = 7.3;
const LANTERN_RADIUS = 2.55;
/** Bursts are sized for the High tier's rings; a tier's own scale them. */
const REFERENCE = Object.freeze({ keys: 380, lights: 950 });

/** A ring of records in one interleaved instance buffer over a base geometry. */
function createRing(capacity, names, base) {
    const data = new Float32Array(capacity * FALL_FX_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, FALL_FX_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    Object.entries(base.attributes).forEach(([name, value]) => geometry.setAttribute(name, value));
    names.forEach((name, k) => {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    geometry.instanceCount = capacity;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, -20), 300);
    return {
        capacity, data, buffer, geometry, ends: new Float64Array(capacity).fill(-Infinity), cursor: 0, dirty: false,
    };
}

/** Write a record into the next spent slot; false when every slot searched is still in flight. */
function writeRing(ring, now, end, values) {
    let slot = -1;
    const reach = Math.min(ring.capacity, SEARCH);
    for (let hop = 0; hop < reach; hop += 1) {
        const index = (ring.cursor + hop) % ring.capacity;
        if (ring.ends[index] <= now) {
            slot = index;
            break;
        }
    }
    if (slot < 0) {
        // Not near the cursor: look through the whole ring before the new one is let go.
        for (let index = 0; index < ring.capacity && slot < 0; index += 1) {
            if (ring.ends[index] <= now) slot = index;
        }
    }
    if (slot < 0) return false;
    /* eslint-disable no-param-reassign */
    ring.cursor = (slot + 1) % ring.capacity;
    ring.ends[slot] = end;
    ring.data.set(values, slot * FALL_FX_STRIDE);
    ring.dirty = true;
    /* eslint-enable no-param-reassign */
    return true;
}

function clearRing(ring) {
    /* eslint-disable no-param-reassign */
    ring.data.fill(0);
    ring.ends.fill(-Infinity);
    ring.cursor = 0;
    ring.dirty = true;
    /* eslint-enable no-param-reassign */
}

function liveIn(ring, now) {
    if (!ring) return 0;
    let n = 0;
    for (let i = 0; i < ring.capacity; i += 1) if (ring.ends[i] > now) n += 1;
    return n;
}

/**
 * A pair of maple keys as they hang and fall together: two nuts joined at the middle and a wing
 * out along +x and along -x, lying in the xz plane (uv.x runs out along a wing from 0 to 1 and is
 * below zero on the nuts). The vertex stage lifts the wings into a shallow V and pitches each like
 * a propeller blade.
 */
function keyGeometry() {
    const position = [];
    const normal = [];
    const coords = [];
    const index = [];
    const vertex = (x, y, z, u, v) => {
        position.push(x, y, z);
        normal.push(0, 1, 0);
        coords.push(u, v);
        return position.length / 3 - 1;
    };
    // A wing: a leading edge almost straight, a trailing edge that bellies out, a round tip.
    const lead = [[0.1, 0.07], [0.34, 0.1], [0.62, 0.115], [0.86, 0.095], [1.0, 0.03]];
    const trail = [[0.1, -0.07], [0.32, -0.17], [0.6, -0.33], [0.84, -0.31], [1.0, -0.13]];
    for (const side of [1, -1]) {
        const a = lead.map(([x, z], i) => vertex(x * side, 0, z * side, i / (lead.length - 1), 0));
        const b = trail.map(([x, z], i) => vertex(x * side, 0, z * side, i / (trail.length - 1), 1));
        for (let i = 0; i < lead.length - 1; i += 1) index.push(a[i], b[i], a[i + 1], a[i + 1], b[i], b[i + 1]);
        // Its nut: a small lozenge standing a little proud of the wing.
        const nut = [[-0.02, 0, 0], [0.09, 0, 0.1], [0.22, 0, 0], [0.09, 0, -0.1], [0.09, 0.085, 0], [0.09, -0.085, 0]]
            .map(([x, y, z]) => vertex(x * side, y, z * side, -1, 0.5));
        index.push(nut[0], nut[1], nut[4], nut[1], nut[2], nut[4], nut[2], nut[3], nut[4], nut[3], nut[0], nut[4]);
        index.push(nut[1], nut[0], nut[5], nut[2], nut[1], nut[5], nut[3], nut[2], nut[5], nut[0], nut[3], nut[5]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
    geometry.setIndex(index);
    return geometry;
}

/** An acorn about its long axis (y): the nut, and from uv.y 0.6 up its scaly cup and a stub of stalk. */
function acornGeometry() {
    const profile = [[0, -0.5], [0.16, -0.44], [0.28, -0.26], [0.32, 0.02], [0.3, 0.16], [0.36, 0.17], [0.37, 0.3],
        [0.27, 0.43], [0.07, 0.49], [0.045, 0.6], [0, 0.6]].map(([radius, height]) => new THREE.Vector2(radius, height));
    const geometry = new THREE.LatheGeometry(profile, 9);
    geometry.computeVertexNormals();
    return geometry;
}

/** A point rotated about the x, the z and then the y axis (TSL; sines and cosines given). */
function turned(v, cx, sx, cz, sz, cy, sy) {
    const y1 = v.y.mul(cx).sub(v.z.mul(sx));
    const z1 = v.y.mul(sx).add(v.z.mul(cx));
    const x2 = v.x.mul(cz).sub(y1.mul(sz));
    const y2 = v.x.mul(sz).add(y1.mul(cz));
    return vec3(x2.mul(cy).add(z1.mul(sy)), y2, z1.mul(cy).sub(x2.mul(sy)));
}

export class FallEventFx {
    /**
     * @param {object} o
     * @param {object} o.light        the grove's light rig
     * @param {object} o.tier         a row of FALL_TIERS (or a quality name)
     * @param {() => number} [o.rng]
     * @param {(x: number, z: number) => number} [o.groundHeight]
     * @param {Float32Array | null} [o.crownPoints]  [x, y, z, species] per point (FallForest.sampleCrownPoints)
     */
    constructor({
        light, tier, rng = Math.random, groundHeight = () => 0, crownPoints = null,
    }) {
        this.light = light;
        this.tier = fallEventTier(tier);
        this.rng = rng;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'FallEventFx';
        this.owned = [];
        this.time = 0;
        this.serial = -1;
        this.epoch = null;
        this.sparkFeed = 0;
        this.point = new THREE.Vector3();
        this.foot = new THREE.Vector3();
        /** Thrown and let go since the world began (a frenzy lets go, never cuts). */
        this.stats = { thrown: 0, refused: 0 };
        // The crowns that hang over the board (those of the two great trees, else any near it), by
        // side: what falls from them falls where the eye is.
        this.crowns = { left: [], right: [], all: [] };
        const gather = (half, far) => {
            this.crowns.left.length = 0;
            this.crowns.right.length = 0;
            this.crowns.all.length = 0;
            for (let i = 0; crownPoints && i + 3 < crownPoints.length; i += 4) {
                const x = crownPoints[i];
                const z = crownPoints[i + 2];
                if (Math.abs(x) < half && z > far && z < 9) {
                    const point = [x, crownPoints[i + 1], z];
                    this.crowns.all.push(point);
                    if (x < -2) this.crowns.left.push(point);
                    else if (x > 2) this.crowns.right.push(point);
                }
            }
        };
        gather(17, -11);
        if (this.crowns.left.length < 6 || this.crowns.right.length < 6) gather(26, -32);
        this.uFoot = uniform(new THREE.Vector3(0, 0, 6));
        this.uLantern = uniform(0);
    }

    random() {
        const value = this.rng();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
    }

    build() {
        const { tier } = this;
        const add = (name, ring, material, order) => {
            const mesh = new THREE.Mesh(ring.geometry, material);
            mesh.name = name;
            mesh.frustumCulled = false;
            mesh.matrixAutoUpdate = false;
            if (order !== undefined) mesh.renderOrder = order;
            this.group.add(mesh);
            this.owned.push(ring.geometry, material);
            return mesh;
        };
        if (tier.keys > 0) {
            const base = keyGeometry();
            this.owned.push(base);
            this.keyRing = createRing(tier.keys, ['iKeyA', 'iKeyB', 'iKeyC'], base);
            add('FallMapleKeys', this.keyRing, this.createKeyMaterial());
        }
        if (tier.acorns > 0) {
            const base = acornGeometry();
            this.owned.push(base);
            this.acornRing = createRing(tier.acorns, ['iAcornA', 'iAcornB', 'iAcornC'], base);
            add('FallAcorns', this.acornRing, this.createAcornMaterial());
        }
        const plane = new THREE.PlaneGeometry(1, 1);
        this.owned.push(plane);
        if (tier.lights > 0) {
            this.lightRing = createRing(tier.lights, ['iLightA', 'iLightB', 'iLightC'], plane);
            add('FallEventLights', this.lightRing, this.createLightMaterial(), 34);
        }
        if (tier.lanterns > 0) this.buildLanterns(plane);
        return this;
    }

    /** Maple keys: winged seeds that spin as they sink, lit like the leaves. */
    createKeyMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
        material.name = 'FallMapleKeys';
        const A = attribute('iKeyA', 'vec4'); // start, birth
        const B = attribute('iKeyB', 'vec4'); // the throw it was given, how fast it sinks
        const C = attribute('iKeyC', 'vec4'); // size, seed, spin (rad/s), seconds until it lands
        const vNormal = varyingProperty('vec3', 'vFallKeyNormal');
        const vWorld = varyingProperty('vec3', 'vFallKeyWorld');
        material.positionNode = Fn(() => {
            const age = light.uTime.sub(A.w).toVar();
            const fallTime = max(C.w, 0.05).toVar();
            const flown = clamp(age, 0, fallTime).toVar();
            const seed = C.y;
            // 1 in the air, easing to 0 as it comes to lie.
            const inAir = float(1).sub(smoothstep(fallTime.sub(0.22), fallTime, age)).toVar();
            // Thrown, the throw spent against the air; sinking, up to its own pace within a moment.
            const thrown = float(1).sub(exp(flown.mul(-KEY_DRAG))).div(KEY_DRAG);
            const sunk = B.w.mul(flown.sub(float(1).sub(exp(flown.mul(-KEY_SINK))).div(KEY_SINK)));
            const theta = seed.mul(TAU).add(C.z.mul(flown)).toVar();
            const wander = theta.mul(0.27).add(seed.mul(9));
            const at = A.xyz.add(B.xyz.mul(thrown)).add(vec3(0, sunk.negate(), 0))
                .add(vec3(cos(wander), 0, sin(wander)).mul(inAir.mul(0.13))).toVar();
            const life = fallTime.add(KEY_REST);
            const present = smoothstep(0, 0.22, age).mul(float(1).sub(smoothstep(life.sub(0.55), life, age)))
                .mul(step(0, age)).toVar();
            // The pair turns like a propeller: both wings ride high (a shallow V) and each is pitched
            // to bite the air its own way; it flattens out as it comes to lie.
            const local = positionGeometry.mul(C.x.mul(present)).toVar();
            const blade = positionGeometry.x.sign();
            const rise = inAir.mul(0.42);
            const pitch = inAir.mul(0.34);
            const shaped = vec3(
                local.x.mul(cos(rise)),
                local.y.add(local.x.abs().mul(sin(rise))).add(local.z.mul(blade).mul(pitch)),
                local.z,
            );
            const cy = cos(theta).toVar();
            const sy = sin(theta).toVar();
            const one = float(1);
            const none = float(0);
            vNormal.assign(turned(
                normalize(vec3(blade.mul(sin(rise)).negate(), 1, blade.mul(pitch).negate())),
                one,
                none,
                one,
                none,
                cy,
                sy,
            ));
            const placed = at.add(turned(shaped, one, none, one, none, cy, sy)).toVar();
            vWorld.assign(placed);
            return placed;
        })();
        const st = uv();
        const wing = step(0, st.x);
        // Papery tan with fine veins fanning out from the nut; the nut is a darker brown.
        const veins = sin(st.y.mul(15).add(st.x.mul(5))).mul(0.5).add(0.5).mul(0.22)
            .add(0.78);
        const paper = mix(color(0xb8741e), color(0xf0b84a), saturate(st.x)).mul(veins);
        const albedo = mix(color(0x5a3414), paper, wing);
        const normal = normalize(vNormal);
        const view = normalize(cameraPosition.sub(vWorld));
        const facing = dot(normal, light.uSunDir).abs();
        // The wing is thin: with the sun behind it, it glows like a leaf.
        const through = pow(saturate(dot(view, light.uSunDir).negate()), 3).mul(wing);
        const glowing = pow(paper, vec3(0.8)).mul(vec3(1.25, 1.0, 0.6));
        const lit = albedo.mul(facing.mul(0.75).add(0.25)).add(glowing.mul(through).mul(1.1))
            .mul(light.uSunColor).mul(light.sunlight())
            .add(albedo.mul(light.ambient(vec3(0, 0.2, 0))).mul(2.0));
        material.colorNode = vec4(light.haze(lit, { world: vWorld }), 1);
        return material;
    }

    /** Acorns: they drop, bounce once, roll to a stop and lie. */
    createAcornMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'FallAcorns';
        const A = attribute('iAcornA', 'vec4'); // start, birth
        const B = attribute('iAcornB', 'vec4'); // drift x and z (m/s), seconds until it lands, life
        const C = attribute('iAcornC', 'vec4'); // size, seed, the floor's height where it lands, how high it bounces
        const vNormal = varyingProperty('vec3', 'vFallAcornNormal');
        const vWorld = varyingProperty('vec3', 'vFallAcornWorld');
        material.positionNode = Fn(() => {
            const age = light.uTime.sub(A.w).toVar();
            const landing = max(B.z, 0.02).toVar();
            const life = B.w;
            const seed = C.y;
            const bounce = sqrt(max(C.w, 0).mul(2 * ACORN_GRAVITY)).toVar();
            const hopTime = bounce.mul(2 / ACORN_GRAVITY).toVar();
            const fell = clamp(age, 0, landing).toVar();
            const hopped = clamp(age.sub(landing), 0, hopTime).toVar();
            const falling = step(age, landing);
            const yFall = A.y.sub(fell.mul(fell).mul(ACORN_GRAVITY / 2));
            const yHop = C.z.add(bounce.mul(hopped)).sub(hopped.mul(hopped).mul(ACORN_GRAVITY / 2));
            const drift = vec2(B.x, B.y).mul(fell.add(hopped.mul(0.45)));
            const size = C.x.mul(smoothstep(0, 0.08, age)).mul(float(1).sub(smoothstep(life.sub(0.6), life, age)))
                .mul(step(0, age)).toVar();
            // It lies on its side, half its width above the floor it landed on.
            const at = vec3(A.x.add(drift.x), mix(yHop, yFall, falling).add(size.mul(0.3)), A.z.add(drift.y)).toVar();
            // It tumbles while it moves and lies as it stopped.
            const tumble = seed.mul(TAU).add(fell.add(hopped).mul(seed.mul(6).add(5)));
            const heading = seed.mul(37);
            const cx = cos(tumble).toVar();
            const sx = sin(tumble).toVar();
            const cy = cos(heading).toVar();
            const sy = sin(heading).toVar();
            vNormal.assign(turned(normalGeometry, cx, sx, float(1), float(0), cy, sy));
            const placed = at.add(turned(positionGeometry.mul(size), cx, sx, float(1), float(0), cy, sy)).toVar();
            vWorld.assign(placed);
            return placed;
        })();
        const cup = smoothstep(0.52, 0.56, uv().y);
        const normal = normalize(vNormal);
        const view = normalize(cameraPosition.sub(vWorld));
        const albedo = mix(color(0x8a5320), color(0x3c2814), cup);
        const facing = saturate(dot(normal, light.uSunDir).mul(0.6).add(0.4));
        // The nut is polished: it carries a small highlight of the low sun.
        const half = normalize(view.add(light.uSunDir));
        const gloss = pow(saturate(dot(normal, half)), 26).mul(float(1).sub(cup)).mul(0.5);
        const lit = albedo.mul(facing).add(vec3(gloss)).mul(light.uSunColor).mul(light.sunlight())
            .add(albedo.mul(light.ambient(normal)).mul(1.3));
        material.colorNode = vec4(light.haze(lit, { world: vWorld }), 1);
        return material;
    }

    /** Motes of gold dust and sparks on a winding path: points of light, drawn as they add. */
    createLightMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'FallEventLights';
        const A = attribute('iLightA', 'vec4'); // start (a spark: its axis' foot), birth
        const B = attribute('iLightB', 'vec4'); // push (a spark: turn rate, climb, radius), life
        const C = attribute('iLightC', 'vec4'); // kind (0 mote, 1 spark), size, seed, rise (a spark: how its radius grows)
        const vLook = varyingProperty('vec4', 'vFallLightLook'); // colour, how much
        const vStreak = varyingProperty('vec2', 'vFallLightStreak'); // how drawn out, and 1 for a spark
        const vWorld = varyingProperty('vec3', 'vFallLightWorld');
        material.positionNode = Fn(() => {
            const t = light.uTime;
            const age = t.sub(A.w).toVar();
            const life = max(B.w, 0.01).toVar();
            const share = saturate(age.div(life)).toVar();
            const seed = C.z;
            const spark = step(0.5, C.x).toVar();
            // A spark: round its axis, climbing, its circle opening.
            const angle = seed.mul(TAU).add(B.x.mul(age)).toVar();
            const radius = B.z.add(C.w.mul(age)).toVar();
            const sparkAt = A.xyz.add(vec3(cos(angle).mul(radius), B.y.mul(age), sin(angle).mul(radius)));
            const sparkFlight = vec3(sin(angle).mul(radius).mul(B.x).negate(), B.y, cos(angle).mul(radius).mul(B.x));
            // A mote: its first push spent against the air, then its own slow wandering.
            const pushed = float(1).sub(exp(age.mul(-1.4))).div(1.4);
            const wander = vec3(
                sin(age.mul(0.9).add(seed.mul(40))).mul(0.28),
                sin(age.mul(0.7).add(seed.mul(71))).mul(0.15),
                cos(age.mul(0.8).add(seed.mul(53))).mul(0.28),
            );
            const moteAt = A.xyz.add(B.xyz.mul(pushed)).add(wander).add(vec3(0, age.mul(C.w), 0));
            const at = select(spark.greaterThan(0.5), sparkAt, moteAt).toVar();
            const flight = select(spark.greaterThan(0.5), sparkFlight, vec3(0, 0.001, 0)).toVar();
            const alive = step(0, age).mul(step(age, life)).toVar();
            // A mote swells in and thins out; a spark is simply there, and burns down.
            const breath = smoothstep(0, 0.14, share).mul(float(1).sub(smoothstep(0.62, 1, share)));
            const quick = smoothstep(0, 0.04, share).mul(float(1).sub(smoothstep(0.55, 1, share)));
            const present = mix(breath, quick, spark).mul(alive).toVar();
            const size = C.y.mul(present);
            // Face the eye, the quad's long side laid along the flight.
            const toEye = normalize(cameraPosition.sub(at));
            const streak = saturate(length(flight).mul(0.1)).mul(spark).toVar();
            const along = normalize(flight.sub(toEye.mul(dot(flight, toEye))).add(vec3(0, 0.00001, 0)));
            const across = normalize(cross(along, toEye));
            const twinkle = pow(saturate(sin(t.mul(seed.mul(5).add(3)).add(seed.mul(60))).mul(0.5).add(0.5)), 3);
            // Dust is the sun's own gold; a spark is amber, paler while it is young.
            const dust = vec4(light.uSunColor.mul(0.16).add(vec3(0.7, 0.46, 0.13)), twinkle.mul(1.0).add(0.2));
            const ember = vec4(mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.66, 0.2), share.oneMinus()), share.oneMinus().mul(0.7).add(0.3));
            vLook.assign(mix(dust, ember, spark).mul(vec4(1, 1, 1, present)));
            vStreak.assign(vec2(streak, spark));
            vWorld.assign(at);
            return at.add(along.mul(positionGeometry.y.mul(size).mul(streak.mul(2.6).add(1))))
                .add(across.mul(positionGeometry.x.mul(size).mul(streak.mul(-0.35).add(1))));
        })();
        const st = uv();
        const reach = length(st.sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(reach)), 3);
        const halo = exp(reach.mul(-4.2)).mul(saturate(float(1).sub(reach)));
        // (Clamped: with MSAA an edge pixel's centre can lie off the quad, and a power of a negative base is NaN.)
        const comet = mix(float(1), pow(max(st.y, 0), 1.6).mul(0.8).add(0.2), vStreak.x);
        // Dust shows where the sun reaches it (the shafts are drawn in it); a spark is its own light.
        const sunlit = mix(light.sunlight().mul(0.8).add(0.2), float(1), vStreak.y);
        material.colorNode = vLook.rgb.mul(1.5);
        material.opacityNode = core.mul(1.1).add(halo.mul(0.5)).mul(vLook.a).mul(comet)
            .mul(sunlit);
        return material;
    }

    /**
     * The ring of lantern light round the card's foot: small warm lights hovering over the litter.
     * Each has its place in the order of lighting; the count (`uLantern`, 0..1) lights them from
     * the two sides of the card round to the front.
     */
    buildLanterns(plane) {
        const { light, tier } = this;
        const count = tier.lanterns;
        const data = new Float32Array(count * 4); // offset x, offset z, order, seed
        // The near arc only: the far side of the ring would stand behind the card.
        const span = Math.PI * 1.34;
        for (let i = 0; i < count; i += 1) {
            const along = count > 1 ? i / (count - 1) : 0.5;
            // 0 at the middle of the near arc (in front of the card), +-1 at its two ends (beside it).
            const side = along * 2 - 1;
            const angle = Math.PI / 2 + side * span * 0.5;
            const reach = LANTERN_RADIUS * (0.92 + this.random() * 0.2);
            data.set([Math.cos(angle) * reach, Math.sin(angle) * reach, 1 - Math.abs(side) * 0.92 + this.random() * 0.06,
                this.random()], i * 4);
        }
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = plane.index;
        geometry.setAttribute('position', plane.getAttribute('position'));
        geometry.setAttribute('uv', plane.getAttribute('uv'));
        geometry.setAttribute('iLantern', new THREE.InstancedBufferAttribute(data, 4));
        geometry.instanceCount = count;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 6), 60);
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        });
        material.name = 'FallLanternRing';
        const lantern = attribute('iLantern', 'vec4');
        const vLit = varyingProperty('float', 'vFallLanternLit');
        material.positionNode = Fn(() => {
            const t = light.uTime;
            const seed = lantern.w;
            // Lit once the count passes its place; the first ones burn fuller as the ring fills.
            const lit = smoothstep(lantern.z.mul(0.9), lantern.z.mul(0.9).add(0.1), this.uLantern).toVar();
            const bob = sin(t.mul(seed.mul(0.9).add(0.8)).add(seed.mul(40))).mul(0.07);
            const at = this.uFoot.add(vec3(lantern.x, seed.mul(0.32).add(0.24).add(bob), lantern.y)).toVar();
            const flicker = sin(t.mul(seed.mul(3).add(4)).add(seed.mul(90))).mul(0.12).add(0.88);
            vLit.assign(lit.mul(flicker));
            const size = lit.mul(seed.mul(0.16).add(0.44));
            const toEye = normalize(cameraPosition.sub(at));
            const right = normalize(cross(vec3(0, 1, 0), toEye));
            const up = cross(toEye, right);
            return at.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size)));
        })();
        const reach = length(uv().sub(0.5)).mul(2);
        const core = pow(saturate(float(1).sub(reach.mul(3.2))), 2);
        const halo = exp(reach.mul(-3.6)).mul(saturate(float(1).sub(reach)));
        material.colorNode = mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.86, 0.5), core).mul(1.7);
        material.opacityNode = core.mul(0.9).add(halo.mul(0.6)).mul(vLit);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'FallLanternRing';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 33;
        this.lanternMesh = mesh;
        this.group.add(mesh);
        this.owned.push(geometry, material);
    }

    // -- throwing --------------------------------------------------------------------------
    /** A tier's bursts against the reference tier's (High). */
    scale(kind = 'keys') {
        const ring = kind === 'keys' ? this.keyRing : this.lightRing;
        return Math.max(0.2, Math.min(1.5, (ring?.capacity || 0) / REFERENCE[kind]));
    }

    count(thrown) {
        if (thrown) this.stats.thrown += 1;
        else this.stats.refused += 1;
        return thrown;
    }

    /**
     * Throw one maple key from (x, y, z) with a first push (vx, vy, vz); it sinks at `sink` m/s,
     * spinning at `spin` rad/s, and lands where the floor is under where the push carries it.
     */
    key(x, y, z, vx, vy, vz, {
        size = 0.22, sink = 1.3, spin = 9, delay = 0,
    } = {}) {
        if (!this.keyRing || ![x, y, z, vx, vy, vz, size, sink, spin, delay].every(Number.isFinite)) return false;
        // Where the push leaves it (all of the push is spent within a second or so).
        const ground = this.groundHeight(x + vx / KEY_DRAG, z + vz / KEY_DRAG) + 0.03;
        const height = y + vy / KEY_DRAG - ground;
        if (!(height > 0.05) || !(sink > 0.05)) return false;
        // Sinking covers sink x (t - (1 - e^(-kt)) / k): solve for the fall time (it is monotonic).
        let fallTime = height / sink + 1 / KEY_SINK;
        for (let i = 0; i < 6; i += 1) {
            const e = Math.exp(-KEY_SINK * fallTime);
            const f = sink * (fallTime - (1 - e) / KEY_SINK) - (vy * (1 - Math.exp(-KEY_DRAG * fallTime))) / KEY_DRAG
                - (y - ground);
            const slope = sink * (1 - e) - vy * Math.exp(-KEY_DRAG * fallTime);
            if (!(Math.abs(slope) > 1e-4)) break;
            fallTime = Math.max(0.05, fallTime - f / slope);
        }
        if (!Number.isFinite(fallTime)) return false;
        const birth = this.time + Math.max(0, delay);
        return this.count(writeRing(this.keyRing, this.time, birth + fallTime + KEY_REST, [
            x, y, z, birth, vx, vy, vz, sink, size, this.random(), spin, fallTime,
        ]));
    }

    /** Drop one acorn from (x, y, z), drifting (vx, vz); it lands, bounces once and lies. */
    acorn(x, y, z, vx, vz, { size = 0.13, delay = 0 } = {}) {
        if (!this.acornRing || ![x, y, z, vx, vz, size, delay].every(Number.isFinite)) return false;
        // The floor under where it comes down (one refinement: the drift moves the landing).
        let ground = this.groundHeight(x, z);
        let landing = Math.sqrt((2 * Math.max(0.05, y - ground)) / ACORN_GRAVITY);
        ground = this.groundHeight(x + vx * landing, z + vz * landing);
        if (!(y - ground > 0.05)) return false;
        landing = Math.sqrt((2 * (y - ground)) / ACORN_GRAVITY);
        const bounce = Math.min(0.55, (y - ground) * (0.05 + this.random() * 0.05));
        const hop = 2 * Math.sqrt((2 * bounce) / ACORN_GRAVITY);
        const life = landing + hop + ACORN_REST;
        const birth = this.time + Math.max(0, delay);
        return this.count(writeRing(this.acornRing, this.time, birth + life, [
            x, y, z, birth, vx, vz, landing, life, size, this.random(), ground, bounce,
        ]));
    }

    /** One mote of gold dust, pushed (vx, vy, vz) and then rising (or sinking) at `rise` m/s. */
    mote(x, y, z, vx, vy, vz, life, size, rise = 0, delay = 0) {
        if (!this.lightRing || ![x, y, z, vx, vy, vz, life, size, rise, delay].every(Number.isFinite) || !(life > 0)) {
            return false;
        }
        const birth = this.time + Math.max(0, delay);
        return this.count(writeRing(this.lightRing, this.time, birth + life, [
            x, y, z, birth, vx, vy, vz, life, 0, size, this.random(), rise,
        ]));
    }

    /**
     * One spark winding round a standing axis through (x, z) from height y: `turn` rad/s, climbing
     * `climb` m/s on a circle of `radius` that opens by `open` m/s. `phase` (0..1) is where on the
     * circle it starts (sparks sharing a phase and thrown one after another draw one curl).
     */
    spark(x, y, z, turn, climb, radius, life, size, {
        open = 0, delay = 0, phase = this.random(),
    } = {}) {
        if (!this.lightRing || ![x, y, z, turn, climb, radius, life, size, open, delay, phase].every(Number.isFinite)
            || !(life > 0)) return false;
        const birth = this.time + Math.max(0, delay);
        return this.count(writeRing(this.lightRing, this.time, birth + life, [
            x, y, z, birth, turn, climb, radius, life, 1, size, phase, open,
        ]));
    }

    /** A crown point on a side of the board (-1 left, 1 right, 0 either), or null when there is none. */
    crown(side = 0) {
        let points = this.crowns.all;
        if (side < 0 && this.crowns.left.length) points = this.crowns.left;
        else if (side > 0 && this.crowns.right.length) points = this.crowns.right;
        if (!points.length) return null;
        return points[Math.floor(this.random() * points.length) % points.length];
    }

    /**
     * A place in the air beside the board, up where the boughs of the great trees hang over it: on
     * `side` of the card (-1 left, 1 right; where the card leaves no room at its sides, over it),
     * between `high` and `low` down the screen (fractions; less than 0 is above the frame, so what
     * lets go there falls into the picture), `near` to `far` metres into the view. The crowns
     * themselves are no place to throw from: what falls inside one is hidden by its own leaves.
     */
    aloft(stage, side, high, low, near, far) {
        const { board } = stage;
        const room = side < 0 ? board.x0 - 0.06 : 0.94 - board.x1;
        let sx;
        let sy = high + this.random() * (low - high);
        if (room > 0.07) sx = side < 0 ? 0.04 + this.random() * room : board.x1 + 0.02 + this.random() * room;
        else {
            sx = 0.06 + this.random() * 0.88;
            sy = Math.min(sy, board.y0 - 0.03);
        }
        const at = stage.point(sx, sy, near + this.random() * (far - near), this.foot);
        return [at.x, Math.max(at.y, this.groundHeight(at.x, at.z) + 2.2), at.z];
    }

    /** Maple keys shaken out of the crowns beside the board: they let go over most of a second. */
    shakeKeys(cue, stage, pace) {
        const strength = Math.max(0.2, Math.min(1.2, cue.strength));
        const total = Math.round((18 + 34 * strength) * this.scale('keys'));
        for (let i = 0; i < total; i += 1) {
            const [x, y, z] = this.aloft(stage, i % 2 === 0 ? -1 : 1, 0.0, 0.34, 8, 14);
            this.key(x, y, z, (0.3 + this.random() * 1.3) * pace, (this.random() - 0.4) * 0.8, (this.random() - 0.5) * 1.0, {
                size: 0.3 + this.random() * 0.13,
                sink: 1.05 + this.random() * 0.55,
                spin: (7 + this.random() * 6) * (this.random() < 0.5 ? -1 : 1),
                delay: this.random() * 0.9,
            });
        }
    }

    /** A twist: a spiral of keys flung out beside the piece, and a ribbon of light curling up through it. */
    spiral(cue, stage, pace) {
        const side = cue.side < 0 ? -1 : 1;
        const edge = stage.edge(side, cue.row, FALL_STAGE_DEPTH, this.point, 0.01);
        const x = edge.x + side * 1.7;
        const z = edge.z - 0.3;
        const floor = this.groundHeight(x, z);
        const y = Math.max(edge.y, floor + 0.6);
        const keys = Math.round(16 * this.scale('keys'));
        for (let i = 0; i < keys; i += 1) {
            // Flung out in the plane the eye looks at, each a little further round and a little harder.
            const angle = i * 2.4 * side;
            const speed = (2.2 + 0.16 * i) * pace;
            this.key(x, y, z, Math.cos(angle) * speed + side * 1.2, Math.sin(angle) * speed * 0.75 + 1.6, Math.sin(angle * 0.7) * 0.9, {
                size: 0.28 + this.random() * 0.1,
                sink: 1.1 + this.random() * 0.5,
                spin: (9 + this.random() * 5) * side,
                delay: i * 0.016,
            });
        }
        // The ribbon: one curl of sparks, each thrown a moment after the last, the way the piece turned.
        const sparks = Math.round(46 * this.scale('lights'));
        for (let i = 0; i < sparks; i += 1) {
            this.spark(x, Math.max(floor + 0.25, y - 1.3), z, side * 6.4 * pace, 2.5 * pace, 0.36, 1.25, 0.15, {
                open: 0.55, delay: (i / sparks) * 0.62, phase: 0.25,
            });
        }
    }

    /** A hard drop shakes acorns loose over the side it landed on. */
    thump(cue, stage) {
        const strength = Math.max(0.2, Math.min(1, cue.strength));
        // (A few: a long drop lands on nearly every piece of fast play.)
        const total = Math.round(1 + 2.4 * strength);
        for (let i = 0; i < total; i += 1) {
            const [x, y, z] = this.aloft(stage, cue.side, -0.16, 0.06, 7, 11);
            this.acorn(x, y, z, (this.random() - 0.3) * 0.9, (this.random() - 0.5) * 0.7, {
                size: 0.2 + this.random() * 0.07, delay: 0.05 + this.random() * 0.35,
            });
        }
    }

    /** A combo's step: a breath of sparks off the lantern ring, into the vortex. */
    sparks(cue, stage, pace) {
        const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
        const floor = this.groundHeight(centre.x, centre.z);
        const total = Math.round((10 + 26 * Math.min(1, cue.strength)) * this.scale('lights'));
        for (let i = 0; i < total; i += 1) {
            this.spark(centre.x, floor + 0.2 + this.random() * 0.9, centre.z, (1.6 + this.random() * 1.6) * pace, (1.3 + this.random() * 1.7) * pace, 2.5 + this.random() * 1.1, 1.3 + this.random() * 0.9, 0.11 + this.random() * 0.06, {
                open: 0.25, delay: this.random() * 0.25,
            });
        }
    }

    /** A perfect clear: gold dust through all the air the eye can see, clear of the card. */
    dust(cue, stage) {
        const strength = Math.max(0.3, Math.min(1.2, cue.strength));
        const total = Math.round(300 * Math.min(1, strength) * this.scale('lights'));
        for (let i = 0; i < total; i += 1) {
            const depth = 5 + this.random() ** 1.5 * 30;
            const sx = this.random();
            const sy = this.random() * 0.86 - 0.02;
            if (!stage.covered(sx, sy, 0.012)) {
                const at = stage.point(sx, sy, depth, this.point);
                const floor = this.groundHeight(at.x, at.z);
                this.mote(at.x, Math.max(floor + 0.5, at.y), at.z, (this.random() - 0.5) * 0.5, 0.1, (this.random() - 0.5) * 0.5, 4.4 + this.random() * 3.4, 0.07 + this.random() * 0.09, -0.12 - this.random() * 0.16, this.random() * 1.7);
            }
        }
    }

    /**
     * Throw what the director has asked for since the last frame, and keep the vortex in sparks.
     * @param {object} [frame] FallReactions' frame
     * @param {{ time?: number, dt?: number, stage?: object | null }} [options]
     */
    play(frame = {}, { time, dt = 0, stage = null } = {}) {
        this.time = Number.isFinite(time) ? time : this.time;
        const fx = frame && typeof frame === 'object' && frame.fx && typeof frame.fx === 'object' ? frame.fx : null;
        const motion = Number.isFinite(frame?.motion) ? Math.max(0, Math.min(1, frame.motion)) : 1;
        const pace = 0.6 + 0.4 * motion;
        if (fx && fx.epoch !== this.epoch) {
            this.epoch = fx.epoch;
            this.serial = -1;
        }
        const queue = fx && Array.isArray(fx.cues) ? fx.cues : [];
        for (let pass = 0; pass < queue.length; pass += 1) {
            let next = null;
            for (let i = 0; i < queue.length; i += 1) {
                const entry = queue[i];
                if (entry && entry.serial > this.serial && (!next || entry.serial < next.serial)) next = entry;
            }
            if (!next) break;
            this.serial = next.serial;
            if (stage && next.strength > 0) {
                if (next.kind === 'keys') this.shakeKeys(next, stage, pace);
                else if (next.kind === 'spiral') this.spiral(next, stage, pace);
                else if (next.kind === 'thump') this.thump(next, stage);
                else if (next.kind === 'sparks') this.sparks(next, stage, pace);
                else if (next.kind === 'dust') this.dust(next, stage);
            }
        }
        // Sparks caught in the vortex while it turns (a steady feed: the ring lets go when it is full).
        const vortex = Number.isFinite(frame?.vortex) ? Math.max(0, Math.min(1, frame.vortex)) : 0;
        if (stage && vortex > 0.08 && dt > 0 && Number.isFinite(dt)) {
            this.sparkFeed += Math.min(dt, 0.1) * (5 + 34 * vortex) * this.scale('lights');
            const centre = stage.centre(FALL_STAGE_DEPTH, this.point);
            const floor = this.groundHeight(centre.x, centre.z);
            while (this.sparkFeed >= 1) {
                this.sparkFeed -= 1;
                const radius = 2.7 + 0.8 * vortex + (this.random() - 0.5) * 0.7;
                this.spark(centre.x, floor + 0.3 + this.random() * (1.6 + 4 * vortex), centre.z, ((4.2 + 7.5 * vortex) / radius) * pace, (1.0 + 2.2 * vortex) * pace, radius, 1.2 + this.random() * 0.9, 0.09 + this.random() * 0.06, { open: 0.1 });
            }
        } else if (!(vortex > 0.08)) this.sparkFeed = 0;
        // The lantern ring stands on the floor in front of the card's foot.
        if (stage) {
            const { board } = stage;
            const foot = stage.point((board.x0 + board.x1) / 2, board.y1, LANTERN_DEPTH, this.foot);
            this.uFoot.value.set(foot.x, this.groundHeight(foot.x, foot.z), foot.z);
        }
        this.uLantern.value = fx && Number.isFinite(fx.lantern) ? Math.max(0, Math.min(1, fx.lantern)) : 0;
        this.flush();
    }

    /** Hand the GPU whatever was written this frame. */
    flush() {
        [this.keyRing, this.acornRing, this.lightRing].forEach((ring) => {
            if (ring?.dirty) {
                ring.buffer.needsUpdate = true;
                // eslint-disable-next-line no-param-reassign
                ring.dirty = false;
            }
        });
    }

    /** How many of each are in flight at the clock, and what was thrown and let go. */
    counts() {
        return {
            keys: liveIn(this.keyRing, this.time),
            acorns: liveIn(this.acornRing, this.time),
            lights: liveIn(this.lightRing, this.time),
            lantern: this.uLantern.value,
            ...this.stats,
        };
    }

    /** Forget everything in flight (the effects setting off, a seek, a rebuilt director). */
    reset() {
        [this.keyRing, this.acornRing, this.lightRing].forEach((ring) => { if (ring) clearRing(ring); });
        this.serial = -1;
        this.epoch = null;
        this.sparkFeed = 0;
        this.uLantern.value = 0;
        this.flush();
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.keyRing = null;
        this.acornRing = null;
        this.lightRing = null;
        this.lanternMesh = null;
    }
}
