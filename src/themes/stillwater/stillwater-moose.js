/**
 * Stillwater — the old moose of the wood.
 *
 * Now and then (stillwater-night.js) a bull moose comes down out of the mist on the far water to
 * the left of the board: he walks in through the shallows, stops, looks about, lowers his head and
 * drinks (rings run out from his muzzle), lifts it with the water running off, looks across at the
 * spirit's light a long moment, then turns and walks back into the mist the way he came.
 *
 * He is the theme's own figure (scripts/blender/stillwater/moose.py: a distance field of smooth
 * masses meshed in Blender, a 16-bone skeleton, every vertex told what it is), in the theme's
 * compact figure file (stillwater-rig.js). Every pose is made here, as a function of how long he
 * has been there: the walk is a moose's (each leg in turn, hind before fore on the same side),
 * his body rolling a little with it; under the water his legs are hidden, so his hooves may slide.
 *
 * He is lit as the place is (swLight: the moon through the canopy, the sky, the lights that live
 * here) with a pale rim where the moon's halo is behind him, and the mist takes him with his range.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    smoothstep,
    vec3,
    vec4,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import mooseUrl from './assets/moose.glb?url';
import {
    clamp01, lerp, smooth, swFog, swLight, swPart,
} from './stillwater-tsl.js';
import { buildFigure } from './stillwater-rig.js';
import { groundHeight } from './stillwater-plan.js';

/**
 * His visit (stage metres, seconds from when he comes): out of the mist at `from`, along the far
 * shallows to `at`, where he stands; then home to `away`. How deep he wades at most (the tarn is
 * deep out there: he keeps to where his knees are wet), and the beats of his time there.
 */
export const MOOSE = Object.freeze({
    from: Object.freeze([-14.5, -44]),
    at: Object.freeze([-8.4, -25.5]),
    away: Object.freeze([-15.5, -43]),
    /** The way he stands to drink: broadside to the eye, his head toward the board. */
    broadside: 70 * (Math.PI / 180),
    wade: 0.42,
    pace: 1.15,
    /** Metres of ground one whole cycle of his legs covers. */
    stride: 1.75,
    /**
     * Seconds: he steps round broadside, stands and looks about, lowers his head, drinks, lifts it,
     * looks across at her, turns for home.
     */
    square: 2.6,
    stand: 3.4,
    lower: 2.6,
    drink: 8.5,
    lift: 2.4,
    regard: 5,
    turn: 4.5,
});

/** Metres over which he slows to a stand (and gathers pace again when he leaves). */
const EASE = 1.4;
const IN_LENGTH = Math.hypot(MOOSE.at[0] - MOOSE.from[0], MOOSE.at[1] - MOOSE.from[1]);
const OUT_LENGTH = Math.hypot(MOOSE.away[0] - MOOSE.at[0], MOOSE.away[1] - MOOSE.at[1]);
/** Seconds of his walk in and out: at his pace, and twice as long over the metres he eases. */
const IN_TIME = (IN_LENGTH + EASE) / MOOSE.pace;
const OUT_TIME = (OUT_LENGTH + EASE) / MOOSE.pace;

/** Metres walked `t` seconds into a walk of `length` that ends in a stop (or, `starting`, begins from one). */
function walked(t, length, starting = false) {
    const v = MOOSE.pace;
    const slow = (2 * EASE) / v;
    const total = (length + EASE) / v;
    const k = Math.max(0, Math.min(total, t));
    if (starting) {
        if (k < slow) return EASE * (k / slow) ** 2;
        return EASE + v * (k - slow);
    }
    const full = total - slow;
    if (k < full) return v * k;
    const u = (k - full) / slow;
    return length - EASE + EASE * (1 - (1 - u) ** 2);
}
/** When each beat begins (seconds from his coming). */
export const MOOSE_BEATS = Object.freeze((() => {
    const arrive = IN_TIME;
    const squared = arrive + MOOSE.square;
    const lower = squared + MOOSE.stand;
    const drink = lower + MOOSE.lower;
    const lift = drink + MOOSE.drink;
    const regard = lift + MOOSE.lift;
    const turn = regard + MOOSE.regard;
    const leave = turn + MOOSE.turn;
    const gone = leave + OUT_TIME;
    return {
        arrive, squared, lower, drink, lift, regard, turn, leave, gone,
    };
})());
/** Seconds he is there, from his first step out of the mist to his last into it. */
export const MOOSE_SPAN = MOOSE_BEATS.gone;

/** His legs (each a chain of three bones) and when in the cycle each is lifted (a lateral walk). */
const LEGS = Object.freeze([
    { bones: ['thighL', 'shinL', 'hindL'], phase: 0.0, hind: true },
    { bones: ['armL', 'foreL', 'canL'], phase: 0.25, hind: false },
    { bones: ['thighR', 'shinR', 'hindR'], phase: 0.5, hind: true },
    { bones: ['armR', 'foreR', 'canR'], phase: 0.75, hind: false },
]);
/** Share of a leg's cycle its hoof is on the ground. */
const STANCE = 0.66;

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Where he is and what he is doing `age` seconds after he came: { x, z (stage), heading (rad, 0 =
 * toward +z), walking 0..1, cycle (how far through his legs' cycle), neck, head (pitch, rad: + is
 * down), look (yaw of his head, rad) }. A pure function of the age.
 */
export function mooseAt(age, out = {}) {
    const B = MOOSE_BEATS;
    const o = out;
    const t = Math.max(0, age);
    const inHeading = Math.atan2(MOOSE.at[0] - MOOSE.from[0], MOOSE.at[1] - MOOSE.from[1]);
    const outHeading = Math.atan2(MOOSE.away[0] - MOOSE.at[0], MOOSE.away[1] - MOOSE.at[1]);
    o.neck = 0;
    o.head = 0;
    o.look = 0;
    if (t < B.arrive) {
        // Walking in: slowing over his last strides.
        const d = walked(t, IN_LENGTH);
        const e = d / IN_LENGTH;
        o.x = lerp(MOOSE.from[0], MOOSE.at[0], e);
        o.z = lerp(MOOSE.from[1], MOOSE.at[1], e);
        o.heading = inHeading;
        o.walking = 1 - smooth(IN_LENGTH - EASE * 0.6, IN_LENGTH, d);
        o.cycle = d / MOOSE.stride;
        o.neck = -0.05;
        o.head = 0.08;
    } else if (t < B.leave) {
        o.x = MOOSE.at[0];
        o.z = MOOSE.at[1];
        o.walking = 0;
        o.cycle = IN_LENGTH / MOOSE.stride;
        // A few slow steps round on the spot: broadside as he comes to a stand, round for home after.
        const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
        const square = smooth(B.arrive, B.squared, t);
        const home = smooth(B.turn, B.leave, t);
        o.heading = inHeading + wrap(MOOSE.broadside - inHeading) * square
            + wrap(outHeading - MOOSE.broadside) * home;
        const stepping = t < B.squared ? Math.sin(Math.PI * square) : Math.sin(Math.PI * home);
        if (t < B.squared || t >= B.turn) {
            o.walking = stepping * 0.6;
            o.cycle += ((Math.min(t, B.squared) - B.arrive) * 0.5) / MOOSE.stride
                + (Math.max(0, t - B.turn) * 0.5) / MOOSE.stride;
        } else o.cycle += (MOOSE.square * 0.5) / MOOSE.stride;
        // He looks about as he stands.
        const about = Math.sin((t - B.squared) * 1.3) * 0.35 * smooth(B.squared - 0.5, B.squared + 0.5, t)
            * (1 - smooth(B.lower - 0.8, B.lower, t));
        // Head down to the water, a while there, up again with the water running off.
        const down = smooth(B.lower, B.drink, t) * (1 - smooth(B.lift, B.regard, t));
        o.neck = lerp(-0.05, 0.98, down);
        o.head = lerp(0.08, 0.62, down) + Math.sin(t * 2.4) * 0.03 * down;
        // Then across at her light, a long moment.
        const regard = smooth(B.regard - 0.6, B.regard + 1.2, t) * (1 - smooth(B.turn, B.turn + 1.5, t));
        // (Toward her light: she is ahead of him and to his right as he stands broadside.)
        o.look = about - regard * 1.0;
        o.neck += -0.12 * regard;
    } else {
        const d = walked(t - B.leave, OUT_LENGTH, true);
        const e = Math.min(1, d / OUT_LENGTH);
        o.x = lerp(MOOSE.at[0], MOOSE.away[0], e);
        o.z = lerp(MOOSE.at[1], MOOSE.away[1], e);
        o.heading = outHeading;
        o.walking = Math.max(0.6, smooth(0, EASE * 0.6, d));
        o.cycle = IN_LENGTH / MOOSE.stride + ((MOOSE.square + MOOSE.turn) * 0.5) / MOOSE.stride + d / MOOSE.stride;
        o.neck = -0.05;
        o.head = 0.08;
    }
    return o;
}

/** How much of him shows (he comes out of the mist and goes back into it): 0..1. */
export function mooseShown(age) {
    return smooth(0, 2.5, age) * (1 - smooth(MOOSE_SPAN - 2.5, MOOSE_SPAN, age));
}

/**
 * @param {object} u  shared uniforms
 */
export function createMoose(u) {
    const group = new THREE.Group();
    group.name = 'StillwaterMoose';
    group.visible = false;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'StillwaterMoose';
    material.fog = false;
    material.toneMapped = false;
    const col = attribute('color', 'vec4');
    material.fragmentNode = Fn(() => {
        const P = positionWorld;
        const N = normalize(normalWorld).toVar();
        const V = normalize(P.sub(cameraPosition));
        const kind = col.x;
        const ao = col.y.mul(0.6).add(0.4);
        // What he is: dark brown-black hide, pale grey-brown stockings, a lighter muzzle, pale antlers.
        const hide = vec3(0.028, 0.019, 0.013);
        const leg = vec3(0.16, 0.135, 0.11);
        const muzzle = vec3(0.05, 0.036, 0.027);
        const horn = vec3(0.3, 0.26, 0.2);
        const eye = vec3(0.004, 0.004, 0.004);
        const isEye = smoothstep(0.1, 0.2, kind).mul(float(1.0).sub(smoothstep(0.2, 0.3, kind)));
        const coat = mix(mix(hide, leg, smoothstep(0.25, 0.4, kind)), muzzle, smoothstep(0.55, 0.7, kind));
        const albedo = mix(coat, horn, smoothstep(0.85, 1.0, kind)).toVar();
        albedo.assign(mix(albedo, eye, isEye));
        const lit = swLight(u, albedo, N, P, { wrap: 0.55, local: 0.8 }).mul(ao).toVar();
        // A pale rim where the moon's halo stands behind him (his outline against the mist).
        const facing = clamp(dot(N, V).negate(), 0.0, 1.0);
        const rim = float(1.0).sub(facing);
        const behind = clamp(dot(V, u.moonDir).mul(0.5).add(0.5), 0.0, 1.0);
        lit.addAssign(u.glow.mul(rim.mul(rim).mul(rim)).mul(behind.mul(0.7).add(0.2)).mul(0.4).mul(u.breath));
        // The water he stands in darkens his legs where they go in.
        const wet = smoothstep(0.35, -0.05, P.y);
        lit.mulAssign(float(1.0).sub(wet.mul(0.6)));
        // (A little less of the mist than his range takes: he is what the eye is drawn to.)
        return vec4(swFog(u, lit, P, 0.8), 1.0);
    })();

    const part = swPart('StillwaterMoose', null, material, 13, { mesh: group });
    part.ready = false;
    part.failed = false;
    let built = null;
    let disposed = false;
    const pose = {};
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    /** The hooves' and the muzzle's places in the model frame (from the file's bones). */
    const anchors = {};
    /** Each leg's hoof height as of the last pose (world), to tell when one goes down. */
    const lastLift = [0, 0, 0, 0];

    part.load = async (loader = new GLTFLoader()) => {
        try {
            const gltf = await loader.loadAsync(mooseUrl);
            if (disposed) return false;
            built = buildFigure(gltf, material);
            built.mesh.renderOrder = 13;
            built.mesh.layers.mask = group.layers.mask;
            group.add(built.mesh);
            LEGS.forEach((leg) => {
                const last = leg.bones[2];
                anchors[last] = built.rest[last].clone();
            });
            part.ready = true;
            return true;
        } catch (error) {
            part.failed = true;
            console.warn('[Stillwater] The moose could not be loaded.', error);
            return false;
        }
    };

    /**
     * Pose him `age` seconds into his visit, standing on the stage drawn in by `squeeze`. Returns
     * events: { type: 'step', x, z } as a hoof goes down in the water, { type: 'sip', x, z } while
     * he drinks (the world rings the water for both).
     */
    part.update = (age, squeeze = 1) => {
        const events = [];
        if (!built) return events;
        const p = mooseAt(age, pose);
        const x = p.x * squeeze;
        const ground = groundHeight(p.x, p.z);
        const y = Math.max(ground, -MOOSE.wade);
        group.position.set(x, y, p.z);
        group.rotation.set(0, p.heading, 0);
        const b = built.bones;
        const reset = (name) => b[name]?.quaternion.identity();
        Object.keys(b).forEach(reset);
        // The legs: each swung forward through its swing and back along the ground through its stance.
        const walk = p.walking;
        const lifted = [];
        LEGS.forEach((leg) => {
            const ph = (((p.cycle + leg.phase) % 1) + 1) % 1;
            let swingAngle;
            let lift = 0;
            if (ph < STANCE) {
                // On the ground: from forward to back.
                swingAngle = lerp(-0.3, 0.26, ph / STANCE);
            } else {
                const k = (ph - STANCE) / (1 - STANCE);
                swingAngle = lerp(0.26, -0.3, k * k * (3 - 2 * k));
                lift = Math.sin(Math.PI * k);
            }
            const upper = swingAngle * walk;
            // The knee and the hock fold as the leg comes through (forward knee back, hock forward).
            const fold = lift * walk;
            const [top, mid, low] = leg.bones;
            b[top]?.quaternion.setFromAxisAngle(X, upper * (leg.hind ? 0.8 : 0.9));
            if (leg.hind) {
                b[mid]?.quaternion.setFromAxisAngle(X, -0.35 * fold);
                b[low]?.quaternion.setFromAxisAngle(X, 0.75 * fold);
            } else {
                b[mid]?.quaternion.setFromAxisAngle(X, 0.25 * fold);
                b[low]?.quaternion.setFromAxisAngle(X, 0.95 * fold);
            }
            lifted.push(lift * walk);
        });
        // His body rolls and nods a little with the walk; the root carries all of it.
        const bob = Math.sin(p.cycle * Math.PI * 4) * 0.012 * walk;
        if (b.root) {
            b.root.position.y = built.rest.root.y + bob;
            q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(p.cycle * Math.PI * 2) * 0.02 * walk);
            b.root.quaternion.copy(q);
        }
        // Neck and head: the pitch of each, the look turned in the neck.
        if (b.neck) {
            q.setFromAxisAngle(X, p.neck);
            q2.setFromAxisAngle(Y, p.look * 0.6);
            b.neck.quaternion.copy(q2).multiply(q);
        }
        if (b.head) {
            q.setFromAxisAngle(X, p.head);
            q2.setFromAxisAngle(Y, p.look * 0.4);
            b.head.quaternion.copy(q2).multiply(q);
        }
        group.updateMatrixWorld(true);
        // A hoof going down in the water leaves a ring.
        LEGS.forEach((leg, i) => {
            const was = lastLift[i];
            const now = lifted[i];
            lastLift[i] = now;
            if (was > 0.15 && now <= 0.02 && y < 0) {
                const bone = b[leg.bones[2]];
                if (!bone) return;
                bone.getWorldPosition(tmp);
                events.push({ type: 'step', x: tmp.x, z: tmp.z });
            }
        });
        // His muzzle in the water while he drinks.
        if (age > MOOSE_BEATS.drink && age < MOOSE_BEATS.lift && b.head) {
            tmp.set(0, -0.32, 0.68).applyMatrix4(b.head.matrixWorld);
            events.push({ type: 'sip', x: tmp.x, z: tmp.z });
        }
        return events;
    };

    /** Where his muzzle is now (world), for the eyes that turn to him. */
    part.muzzleWorld = (out = new THREE.Vector3()) => {
        if (!built?.bones.head) return out.set(MOOSE.at[0], 1.5, MOOSE.at[1]);
        return out.set(0, -0.32, 0.68).applyMatrix4(built.bones.head.matrixWorld);
    };

    part.dispose = () => {
        disposed = true;
        if (built) {
            built.mesh.geometry.dispose();
            built.mesh.skeleton?.dispose?.();
        }
        material.dispose();
    };
    part.shownAt = mooseShown;
    return part;
}

/** (For the tests: how many seconds each part of his visit takes.) */
export const MOOSE_TIMES = Object.freeze({ in: IN_TIME, out: OUT_TIME });

export { clamp01 };
