/**
 * Grainfields — the herd in the barley.
 *
 * A band of Hokkaido native horses (Dosanko: stocky, short-legged, thick-maned; bay, chestnut,
 * dun, grey, black-bay), two of them foals at their mothers' sides. They live on the near field
 * (grainfields-herd-sim.js): they graze, wander to new grass, trot, canter round, and now and
 * then gallop out of the picture over the crest, off a side of the frame or behind the eye, and
 * come back in somewhere else. When the storm breaks with a chain they run; with a T-spin they
 * wheel round.
 *
 * The horse is authored in Blender (scripts/blender/grainfields/horse.py, loaded by
 * grainfields-assets.js as `assets.horse`): one mesh whose vertex colour names the part each
 * vertex belongs to (R: body, neck and head, the four legs, the tail; G a dark mask for the mane,
 * tail and lower legs; B a light one for the muzzle and belly), skin weights (`_rig`) and the
 * pivots the joints turn about. The vertex stage poses it: each leg turns at its shoulder or
 * hip, folds at its knee or hock and at its fetlock (grainfields-gait.js gives the angles for the
 * gait's footfalls); the neck bends along its length and turns to look, the head nods at the
 * atlas, the ears turn; the tail lifts and swishes, more toward its end; the body pitches,
 * banks into a turn and rides up and down on the legs. A band of skin where each part meets the
 * trunk follows it partly, so nothing tears.
 *
 * Unlit, lit by the shared light: the coat by the sun through the deck and the sky, a rim of
 * light round the silhouette when the sun is behind it, then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cos,
    dot,
    float,
    floor,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    select,
    sin,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { groundHeight } from './grainfields-plan.js';
import { aerial } from './grainfields-light.js';
import { deckShadow } from './grainfields-tsl.js';
import { HERD, createHerdSim } from './grainfields-herd-sim.js';

export { HERD };

/** The horse's parts by id (its vertex colour's red × 8). */
export const HORSE_PART = Object.freeze({
    body: 0, neck: 1, frontLeft: 2, frontRight: 3, hindLeft: 4, hindRight: 5, tail: 6,
});
/** Coats (linear): bay, chestnut, dun, grey, black-bay. */
const COATS = Object.freeze([
    [0.105, 0.05, 0.022], [0.17, 0.065, 0.025], [0.3, 0.21, 0.11], [0.42, 0.41, 0.39], [0.04, 0.025, 0.018],
]);
/** The body pitches and banks about this point (the middle of the barrel), horse frame. */
const BODY_CENTRE = Object.freeze([0, 1.0, -0.05]);

/** A point turned about the x axis through a pivot (y, z); positive turns +z down, -y back. */
function aboutX(p, pivot, angle) {
    const c = cos(angle);
    const s = sin(angle);
    const qy = p.y.sub(pivot.x);
    const qz = p.z.sub(pivot.y);
    return vec3(p.x, qy.mul(c).sub(qz.mul(s)).add(pivot.x), qy.mul(s).add(qz.mul(c)).add(pivot.y));
}
function dirAboutX(n, angle) {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(n.x, n.y.mul(c).sub(n.z.mul(s)), n.y.mul(s).add(n.z.mul(c)));
}
/** A point turned about the y axis through a pivot (x, z). */
function aboutY(p, pivot, angle) {
    const c = cos(angle);
    const s = sin(angle);
    const qx = p.x.sub(pivot.x);
    const qz = p.z.sub(pivot.y);
    return vec3(qx.mul(c).add(qz.mul(s)).add(pivot.x), p.y, qz.mul(c).sub(qx.mul(s)).add(pivot.y));
}
function dirAboutY(n, angle) {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(n.x.mul(c).add(n.z.mul(s)), n.y, n.z.mul(c).sub(n.x.mul(s)));
}
/** A point turned about the z axis through a pivot (x, y); positive leans +y toward +x. */
function aboutZ(p, pivot, angle) {
    const c = cos(angle);
    const s = sin(angle);
    const qx = p.x.sub(pivot.x);
    const qy = p.y.sub(pivot.y);
    return vec3(qx.mul(c).add(qy.mul(s)).add(pivot.x), qy.mul(c).sub(qx.mul(s)).add(pivot.y), p.z);
}
function dirAboutZ(n, angle) {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(n.x.mul(c).add(n.y.mul(s)), n.y.mul(c).sub(n.x.mul(s)), n.z);
}

function herdMaterial(u, t, pivots) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsHerd';
    material.fog = false;
    const aPose = attribute('aPose', 'vec4'); // x, ground y, z, heading
    const aBody = attribute('aBody', 'vec4'); // pitch, roll, bob, scale
    const aHead = attribute('aHead', 'vec4'); // neck, neck yaw, head, ears
    const aFront = attribute('aFront', 'vec4'); // front left upper, lower; front right upper, lower
    const aHind = attribute('aHind', 'vec4'); // hind left upper, lower; hind right upper, lower
    const aFet = attribute('aFet', 'vec4'); // the fetlocks: front left, front right, hind left, hind right
    const aTail = attribute('aTail', 'vec4'); // tail lift, swish, coat
    const paint = attribute('color', 'vec4'); // part / 8, dark, light, 1
    const rig = attribute('_rig', 'vec4'); // root, joint / head / along the tail, fetlock / up the neck, ears
    const vN = varying(vec3(0.0, 1.0, 0.0), 'gfHerdNormal');
    const vInfo = varying(vec4(0.0), 'gfHerdInfo'); // coat, dark, light, sunlit
    // A pivot's (y, z) (rotations about x), or its (x, z) (about y).
    const yz = (name) => vec2(pivots[name][1], pivots[name][2]);
    material.positionNode = Fn(() => {
        const part = floor(paint.x.mul(8.0).add(0.5)).toVar();
        const p = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();

        // ── A leg: fetlock, then knee or hock, then shoulder or hip ──
        const isLeg = part.greaterThan(1.5).and(part.lessThan(5.5));
        const front = part.lessThan(3.5);
        const left = part.equal(2.0).or(part.equal(4.0));
        const upper = select(front, select(left, aFront.x, aFront.z), select(left, aHind.x, aHind.z));
        const lower = select(front, select(left, aFront.y, aFront.w), select(left, aHind.y, aHind.w));
        const fet = select(front, select(left, aFet.x, aFet.y), select(left, aFet.z, aFet.w));
        const rootPivot = select(front, yz('frontLeft'), yz('hindLeft'));
        const jointPivot = select(front, yz('knee'), yz('hock'));
        const fetPivot = select(front, yz('frontFetlock'), yz('hindFetlock'));
        const a1 = fet.mul(rig.z);
        const a2 = lower.mul(rig.y);
        const a3 = upper.mul(rig.x);
        const ql = aboutX(aboutX(aboutX(p, fetPivot, a1), jointPivot, a2), rootPivot, a3);
        const ml = dirAboutX(dirAboutX(dirAboutX(nrm, a1), a2), a3);
        p.assign(select(isLeg, ql, p));
        nrm.assign(select(isLeg, ml, nrm));

        // ── The neck and head: the ears, the head at the atlas, the neck along its length ──
        const isNeck = part.equal(HORSE_PART.neck);
        const along = rig.z;
        const bend = aHead.x.mul(rig.x).mul(along.mul(0.6).add(0.4));
        const turn = aHead.y.mul(rig.x).mul(along);
        const nod = aHead.z.mul(rig.y);
        const ears = aHead.w.mul(rig.w);
        const neckBase = yz('neck');
        const neckBaseXZ = vec2(0.0, pivots.neck[2]);
        const qn = aboutX(aboutY(aboutX(aboutX(p, yz('ear'), ears), yz('poll'), nod), neckBaseXZ, turn), neckBase, bend);
        const mn = dirAboutX(dirAboutY(dirAboutX(dirAboutX(nrm, ears), nod), turn), bend);
        p.assign(select(isNeck, qn, p));
        nrm.assign(select(isNeck, mn, nrm));

        // ── The tail: swished side to side and lifted, more toward its end ──
        const isTail = part.equal(HORSE_PART.tail);
        const down = rig.y;
        const swish = aTail.y.mul(rig.x).mul(down.mul(0.85).add(0.15));
        const lift = aTail.x.mul(rig.x).mul(down.mul(0.65).add(0.35));
        const tailXZ = vec2(0.0, pivots.tail[2]);
        const qt = aboutX(aboutY(p, tailXZ, swish), yz('tail'), lift);
        const mt = dirAboutX(dirAboutY(nrm, swish), lift);
        p.assign(select(isTail, qt, p));
        nrm.assign(select(isTail, mt, nrm));

        // ── The body: pitched, banked, riding up and down on the legs ──
        const centreYZ = vec2(BODY_CENTRE[1], BODY_CENTRE[2]);
        const centreXY = vec2(BODY_CENTRE[0], BODY_CENTRE[1]);
        p.assign(aboutZ(aboutX(p, centreYZ, aBody.x), centreXY, aBody.y));
        nrm.assign(dirAboutZ(dirAboutX(nrm, aBody.x), aBody.y));
        p.y.addAssign(aBody.z);

        // ── Into the world: sized, turned to its heading, standing on the field ──
        const c = cos(aPose.w);
        const s = sin(aPose.w);
        const q = p.mul(aBody.w);
        const world = vec3(q.x.mul(c).add(q.z.mul(s)), q.y, q.z.mul(c).sub(q.x.mul(s)));
        vN.assign(normalize(vec3(nrm.x.mul(c).add(nrm.z.mul(s)), nrm.y, nrm.z.mul(c).sub(nrm.x.mul(s)))));
        const foot = aPose.xyz;
        vInfo.assign(vec4(aTail.z, paint.y, paint.z, deckShadow(u, t.noise, foot.add(vec3(0.0, 1.5, 0.0))).mul(u.sunUp)));
        return foot.add(world);
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const N = normalize(vN).toVar();
        const k = vInfo.x;
        const coat = vec3(...COATS[0]).toVar();
        for (let i = 1; i < COATS.length; i++) coat.assign(select(k.greaterThan(i - 0.5), vec3(...COATS[i]), coat));
        // The mane, tail and lower legs darker; the muzzle and belly paler.
        const albedo = mix(coat, coat.mul(0.32).add(vec3(0.012, 0.009, 0.007)), vInfo.y)
            .mul(mix(float(1.0), float(1.45), vInfo.z));
        const sunlit = vInfo.w;
        const ndl = clamp(dot(N, u.sunDir), 0.0, 1.0);
        const sky = u.fill.mul(N.y.mul(0.4).add(0.6)).mul(1.4).add(u.bounce.mul(float(1.0).sub(N.y).mul(0.4)));
        const col = albedo.mul(u.sun.mul(ndl).mul(sunlit).add(sky)).toVar();
        // Backlit, a rim of light runs round the silhouette (the coat's hairs lit through).
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const edge = float(1.0).sub(clamp(dot(N, V.negate()), 0.0, 1.0));
        const e2 = edge.mul(edge);
        col.addAssign(u.sun.mul(sunlit).mul(e2.mul(e2)).mul(ahead.mul(ahead)).mul(albedo.add(0.05))
            .mul(1.6));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

/**
 * The instance attributes the vertex stage reads, four floats each, interleaved in one buffer (a
 * pipeline may read at most eight vertex buffers: the mesh's four and this one).
 */
export const HORSE_ATTRIBUTES = Object.freeze(['aPose', 'aBody', 'aHead', 'aFront', 'aHind', 'aFet', 'aTail']);
export const HORSE_STRIDE = HORSE_ATTRIBUTES.length * 4;

/** A rested hind leg (radians at the hip, the hock, the fetlock): cocked, on the toe of its hoof. */
const RESTED = Object.freeze({ upper: 0.1, lower: -0.42, fetlock: 0.95 });

/**
 * Write one horse's pose into the interleaved instance array at `i` (pure; exported for tests):
 * where it stands, its body, neck and head, its legs' joints and its tail.
 */
export function writeHorse(h, i, array, ground = groundHeight) {
    const o = i * HORSE_STRIDE;
    const { legs } = h.gait;
    // A horse at rest stands on three legs, one hind cocked (the side by its seed).
    const restSide = h.seed < 0.5 ? 2 : 3;
    const rest = h.rest || 0;
    const leg = (k, key) => {
        const value = legs[k][key];
        return k === restSide ? value + (RESTED[key] - value) * rest : value;
    };
    array.set([h.x, ground(h.x, h.z) - 0.04, h.z, h.heading], o);
    // Pitch: the gait's, plus a sit back when it brakes; bank into a turn; ride on the legs.
    const pitch = h.gait.pitch - Math.max(0, -h.accel) * 0.012 + Math.max(0, h.accel) * 0.006;
    const roll = Math.max(-0.2, Math.min(0.2, h.speed * h.yawRate * 0.045)) + (restSide === 2 ? 0.025 : -0.025) * rest;
    array.set([pitch, roll, h.gait.bob - 0.02 * rest, h.scale], o + 4);
    array.set([h.neck + h.gait.nod, h.neckYaw, h.head, h.ears], o + 8);
    array.set([leg(0, 'upper'), leg(0, 'lower'), leg(1, 'upper'), leg(1, 'lower')], o + 12);
    array.set([leg(2, 'upper'), leg(2, 'lower'), leg(3, 'upper'), leg(3, 'lower')], o + 16);
    array.set([leg(0, 'fetlock'), leg(1, 'fetlock'), leg(2, 'fetlock'), leg(3, 'fetlock')], o + 20);
    array.set([h.tailLift, h.tailSwish, h.coat, 0], o + 24);
}

/**
 * The herd: `count` horses (tier.herd) from the authored horse (`horse` = assets.horse:
 * { geometry, pivots }). Returns null without a horse.
 */
export function createHerd(u, t, count, horse, { seed } = {}) {
    if (!horse?.geometry || !horse.pivots) return null;
    const sim = createHerdSim({ count, seed });
    const n = sim.horses.length;
    const instanced = new THREE.InstancedBufferGeometry();
    ['position', 'normal', 'color', '_rig'].forEach((name) => {
        if (horse.geometry.attributes[name]) instanced.setAttribute(name, horse.geometry.attributes[name]);
    });
    if (!instanced.attributes._rig) {
        // An older horse without skin weights: its parts turn whole (every weight 1 on the part).
        const rig = new Float32Array(horse.geometry.attributes.position.count * 4).fill(1);
        instanced.setAttribute('_rig', new THREE.BufferAttribute(rig, 4));
    }
    instanced.setIndex(horse.geometry.index);
    const array = new Float32Array(Math.max(1, n) * HORSE_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(array, HORSE_STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    HORSE_ATTRIBUTES.forEach((name, k) => {
        instanced.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    instanced.instanceCount = n;
    const material = herdMaterial(u, t, horse.pivots);
    const mesh = new THREE.Mesh(instanced, material);
    mesh.name = 'GrainfieldsHerd';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    const write = () => {
        sim.horses.forEach((h, i) => writeHorse(h, i, array));
        buffer.needsUpdate = true;
    };
    write();

    return {
        mesh,
        meshes: [mesh],
        sim,
        get horses() { return sim.horses; },
        /** A chain breaks the storm: the horses run. */
        run(time) { sim.run(time); },
        /** A T-spin: the horses wheel round. */
        wheel(time) { sim.wheel(time); },
        /** A hard drop: heads up. */
        startle(time) { sim.startle(time); },
        /** The view the band picks its grazing grounds in (bearings, degrees). */
        setView(view) { sim.setView(view); },
        /** Reduced motion: walks and trots only. */
        setCalm(on) { sim.setCalm(on); },
        /** A seek: the band's life replayed up to `time`. */
        reset(time = 0) {
            sim.reset(time);
            write();
        },
        update(time, dt) {
            sim.update(time, dt);
            write();
        },
        dispose() {
            instanced.dispose();
            material.dispose();
        },
    };
}
