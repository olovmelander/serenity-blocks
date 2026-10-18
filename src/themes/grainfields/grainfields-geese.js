/**
 * Grainfields — the geese.
 *
 * Lapporten's Sami name, Čuonjávággi, is the goose valley. Skeins of geese cross the sky over the
 * fields in long V's, wings beating slowly, dark against the bright air; and when the game climbs
 * a level a skein lifts off the field near the eye and flies away out through the gate.
 *
 * One instanced mesh: each bird a body and two wings (beating in the vertex stage); its place is
 * a closed function of the clock, its skein and its slot in the V (no per-frame writes). The
 * level-up skein starts from `u.skein` (start time; negative when none flies).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    float,
    fract,
    positionGeometry,
    positionWorld,
    select,
    sin,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE, PLACES, mulberry32 } from './grainfields-core.js';
import { aerial } from './grainfields-light.js';

/**
 * The skeins that cross by themselves: where their line runs (a start and an end point, metres),
 * how high, how fast (m/s), how many birds, and how long a crossing takes before the next.
 */
const SKEINS = Object.freeze([
    Object.freeze({
        from: [-1400, -620], to: [1500, -780], y: 120, speed: 17, birds: 13, period: 210, phase: 30,
    }),
    Object.freeze({
        from: [1600, -1250], to: [-1700, -1100], y: 190, speed: 15, birds: 9, period: 260, phase: 160,
    }),
]);
/** The level-up skein: from over the field near the eye out through the gate. */
const OUTBOUND = Object.freeze({ birds: 11, speed: 19, climb: 0.05 });
const SLOTS = 17;
const BIRD_SCALE = 2.2;

/** One bird: a body and two wings, wingspan 1.6 m (the wings flagged by aWing: −1 left, +1 right). */
function birdGeometry() {
    const p = [
        // body
        0, 0, 0.45, 0.09, 0, -0.3, -0.09, 0, -0.3,
        // left wing (root to tip)
        0, 0, 0.08, -0.8, 0, -0.08, 0, 0, -0.18,
        // right wing
        0, 0, 0.08, 0, 0, -0.18, 0.8, 0, -0.08,
    ];
    const wing = [0, 0, 0, 0, -1, 0, 0, 0, 1];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    return g;
}

export function createGeese(u, t, count = 26) {
    const geometry = birdGeometry();
    // Per bird: skein (0, 1 the crossings, 2 the level-up one), slot in the V, a seed.
    const random = mulberry32(0x6e5e);
    const rows = [];
    SKEINS.forEach((s, k) => {
        for (let i = 0; i < Math.min(s.birds, SLOTS); i++) rows.push(k, i, random(), 0);
    });
    for (let i = 0; i < OUTBOUND.birds; i++) rows.push(2, i, random(), 0);
    const limit = Math.max(0, Math.min(rows.length / 4, Math.round(count)));
    const data = new Float32Array(rows.slice(0, limit * 4));
    geometry.setAttribute('aBird', new THREE.InstancedBufferAttribute(data, 4));
    geometry.instanceCount = limit;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsGeese';
    material.side = THREE.DoubleSide;
    material.fog = false;
    const bird = attribute('aBird', 'vec4');
    const wingAttr = attribute('aWing', 'float');
    material.positionNode = Fn(() => {
        const k = bird.x;
        const slot = bird.y;
        const seed = bird.z;
        // The V: the leader at the point, then alternate sides, each a rank further back.
        const rank = slot.add(1.0).mul(0.5).floor();
        const side = select(fract(slot.mul(0.5)).greaterThan(0.25), float(1.0), float(-1.0));
        const back = rank.mul(3.4);
        const out = rank.mul(2.6).mul(side);
        // The crossings: along their line, one pass per period.
        const crossing = (s) => {
            const fx = float(s.from[0]);
            const fz = float(s.from[1]);
            const dx = s.to[0] - s.from[0];
            const dz = s.to[1] - s.from[1];
            const len = Math.hypot(dx, dz);
            const run = fract(u.time.add(s.phase).div(s.period)).mul(s.period).mul(s.speed).sub(200.0);
            const dir = vec3(dx / len, 0.0, dz / len);
            const live = smoothstep(-200.0, 0.0, run).mul(float(1.0).sub(smoothstep(len - 100, len + 100, run)));
            return { at: vec3(fx, s.y, fz).add(dir.mul(run)), dir, live };
        };
        const a = crossing(SKEINS[0]);
        const b = crossing(SKEINS[1]);
        // The level-up skein: lifts off the field 80 m out and heads for the gate, climbing.
        const age = u.time.sub(u.skein);
        const toGate = vec3(PLACES.gate.x - EYE.x, 0.0, PLACES.gate.z - EYE.z + 80).normalize();
        const start = vec3(EYE.x + 30, EYE.y - 1.0, EYE.z - 80);
        const flown = age.mul(OUTBOUND.speed);
        const lift = flown.mul(OUTBOUND.climb).add(age.min(4.0).mul(age.min(4.0)).mul(1.2));
        const c = {
            at: start.add(toGate.mul(flown)).add(vec3(0.0, lift, 0.0)),
            dir: toGate,
            live: smoothstep(0.0, 1.0, age).mul(float(1.0).sub(smoothstep(160.0, 200.0, age))),
        };
        const isA = k.lessThan(0.5);
        const isB = k.greaterThan(0.5).and(k.lessThan(1.5));
        const lead = select(isA, a.at, select(isB, b.at, c.at));
        const dir = select(isA, a.dir, select(isB, b.dir, c.dir));
        const live = select(isA, a.live, select(isB, b.live, c.live));
        const rightOf = vec3(dir.z.negate(), 0.0, dir.x);
        const bob = sin(u.time.mul(0.9).add(seed.mul(20.0))).mul(0.6);
        const centre = lead.sub(dir.mul(back)).add(rightOf.mul(out)).add(vec3(0.0, bob, 0.0));
        // Wings beat (each bird a little out of step); a resting skein's birds are gone (size 0).
        const beat = sin(u.time.mul(5.2).add(seed.mul(6.283)));
        const p = positionGeometry;
        const tip = abs(p.x).mul(1.25);
        const lifted = p.y.add(beat.mul(tip).mul(0.55).mul(abs(wingAttr)));
        // Drawn a little larger than life (a goose's 1.6 m span reads as a dot from a kilometre).
        const size = live.mul(BIRD_SCALE);
        const local = vec3(p.x, lifted, p.z).mul(size);
        // Turn the bird to its heading (its local +z forward).
        const fwd = dir;
        const world = rightOf.mul(local.x).add(vec3(0.0, local.y, 0.0)).add(fwd.mul(local.z));
        return centre.add(world);
    })();
    material.colorNode = Fn(() => {
        // Dark birds against the bright air, their undersides catching a little of the light.
        const albedo = vec3(0.035, 0.032, 0.03);
        const lit = albedo.mul(u.fill.mul(1.6).add(u.bounce).add(u.sun.mul(u.sunUp).mul(0.12)));
        return vec4(aerial(u, positionWorld, lit), 1.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsGeese';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
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
