/**
 * Starlight — the lights of play that cross the sky: shooting stars, the fireball and the train
 * it leaves, and the motes a locked piece sends up to its star.
 *
 * All four are one thing, a STREAK: a strip laid along the great circle from one direction to
 * another, its head at a share of the way that is a function of the streak's start time, its
 * tail a set share behind. Nothing is simulated, so a frozen clock replays every streak exactly.
 * The world writes a streak as four rows of a table (starlight-tsl.js): from and start, to and
 * duration, colour and power, kind and shape.
 *
 *   meteor     fast, thin, a white-hot head and an ember tail; gone a moment after it lands
 *   fireball   the same, slow and wide, bright enough to light the lake
 *   train      the fireball's path, left glowing and bent by the high winds while it fades
 *   mote       a soft spark in the piece's colour that eases up a bowed path to its star
 *
 * Each is drawn twice: in the sky and in the lake.
 */
import * as THREE from 'three/webgpu';
import {
    attribute,
    cameraPosition,
    clamp,
    cross,
    exp,
    float,
    int,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { STREAK } from './starlight-core.js';
import {
    SKY_RADIUS, STREAKS, mirrorDir, mirrorShare, sized,
} from './starlight-tsl.js';

const SEGMENTS = 16;
/** Where along a streak its head's heart is: the strip beyond it is the rounded nose. */
const NOSE = 0.9;
/** Seconds a meteor's tail takes to catch up with its head, and a train takes to fade. */
export const METEOR_FADE = 0.22;
export const TRAIN_LIFE = 2.8;

function streakMaterial({
    u, noise, tier, mirrored,
}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const slot = int(attribute('aStreak', 'float').mul(4.0).add(0.5));
    const from = u.streaks.element(slot); // (from, start)
    const to = u.streaks.element(slot.add(1)); // (to, duration)
    const paint = u.streaks.element(slot.add(2)); // (rgb, power)
    const shape = u.streaks.element(slot.add(3)); // (kind, tail, width px, bow)
    const s = positionGeometry.x; // 0 tail … 1 head
    const side = positionGeometry.y;

    const isMote = step(STREAK.mote - 0.5, shape.x).mul(step(shape.x, STREAK.mote + 0.5));
    const isTrain = step(STREAK.mote + 0.5, shape.x);
    const age = u.time.sub(from.w);
    const flown = clamp(age.div(max(to.w, 1e-3)), 0.0, 1.0);
    const over = max(age.sub(to.w), 0.0);
    // A mote eases into its star; a meteor does not slow down.
    const head = mix(flown, flown.oneMinus().mul(flown.oneMinus()).oneMinus(), isMote);
    // The tail follows a set share behind, and catches up once the head has landed. A train's
    // tail stays where the fireball began.
    const chase = min(head.sub(shape.y).add(over.div(METEOR_FADE).mul(shape.y)), head);
    const tail = mix(max(chase, 0.0), float(0.0), isTrain);
    const bowAxis = normalize(cross(from.xyz, to.xyz).add(vec3(0.0, 1e-5, 0.0)));
    const placeAt = (share) => normalize(mix(from.xyz, to.xyz, share)
        .add(bowAxis.mul(sin(share.mul(Math.PI)).mul(shape.w))));
    const at = mix(tail, head, s);
    const d = placeAt(at);
    const ahead = placeAt(at.add(0.01));
    const run = normalize(ahead.sub(d).add(to.xyz.sub(from.xyz).mul(1e-4)));

    const life = mix(mix(float(METEOR_FADE), float(0.0), isMote), float(TRAIN_LIFE), isTrain);
    const alive = step(0.0, age).mul(step(over, life)).mul(step(0.001, paint.w));
    // The train drifts: the high winds bend it more the longer it hangs.
    const drift = sin(at.mul(31.0).add(from.w.mul(3.7))).mul(over.add(0.15)).mul(0.0022)
        .add(sin(at.mul(11.0).add(from.w)).mul(over.add(0.15)).mul(0.0036))
        .mul(isTrain);

    let centre = d;
    let runOut = run;
    let shown = alive.mul(smoothstep(0.0, 0.012, d.y));
    if (mirrored) {
        centre = mirrorDir(u, noise, cameraPosition, d, tier);
        runOut = vec3(run.x, run.y.negate(), run.z);
        shown = shown.mul(mirrorShare(centre)).mul(step(centre.y, -0.0006)).mul(0.8);
    }
    const aside = normalize(cross(runOut, centre));
    // Thin at the tail, full near the head and rounded off in front of it (a flat end reads as
    // an arrowhead); a train is one thin thread.
    const front = clamp(s.sub(NOSE).div(1 - NOSE), 0.0, 1.0);
    const nose = front.mul(front).oneMinus().max(0.0).sqrt();
    const taper = mix(s.pow(0.65).mul(nose), float(0.8), isTrain);
    const width = sized(u, shape.z, 1.3).mul(taper).mul(step(0.002, shown));
    material.positionNode = cameraPosition
        .add(centre.add(aside.mul(side.mul(width).add(drift))).mul(SKY_RADIUS));

    // The light along it.
    const fade = mix(
        mix(over.div(METEOR_FADE).oneMinus(), float(1.0), isMote),
        exp(over.div(-0.85)).mul(0.2).mul(smoothstep(0.0, 0.25, over.add(flown))),
        isTrain,
    );
    const vLight = varying(vec4(paint.xyz, paint.w.mul(shown).mul(max(fade, 0.0))));
    const vAt = varying(vec2(s, side));
    const vKind = varying(vec2(isMote, isTrain));
    const along = clamp(vAt.x, 0.0, 1.0);
    const profile = exp(vAt.y.mul(vAt.y).mul(-4.2));
    // A head that outshines its tail; the tail's far end cools to an ember.
    const body = along.pow(mix(float(2.4), float(1.3), vKind.x));
    const fromHeart = along.sub(NOSE).div(0.085);
    const hot = exp(fromHeart.mul(fromHeart).negate());
    const ember = mix(vec3(1.0, 0.42, 0.14), vLight.rgb, smoothstep(0.1, 0.75, along));
    const meteor = mix(ember, vec3(1.0, 1.0, 1.0), hot.mul(0.75)).mul(body.add(hot.mul(2.6)));
    // A mote keeps its colour, and sparkles.
    const sparkle = sin(along.mul(52.0).sub(u.time.mul(23.0))).mul(0.22).add(0.9);
    const mote = mix(vLight.rgb, vec3(1.0, 1.0, 1.0), hot.mul(0.3)).mul(body.mul(0.8).add(hot.mul(1.5))).mul(sparkle);
    // A train is even along its length, torn into beads as it fades.
    const beads = sin(along.mul(93.0)).mul(sin(along.mul(37.0).add(1.3))).mul(0.45).add(0.6);
    const train = mix(vLight.rgb, vec3(1.0, 0.82, 0.6), 0.4).mul(beads)
        .mul(smoothstep(0.0, 0.08, along)).mul(smoothstep(1.0, 0.9, along));
    const lit = mix(mix(meteor, mote, vKind.x), train, vKind.y);
    material.outputNode = vec4(lit.mul(profile).mul(vLight.a).mul(2.4), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

export function createFx({ u, noise, tier }) {
    const rowsCount = SEGMENTS + 1;
    const position = new Float32Array(rowsCount * 2 * 3);
    const index = [];
    for (let i = 0; i < rowsCount; i += 1) {
        for (let s = 0; s < 2; s += 1) {
            const v = (i * 2 + s) * 3;
            // Closer together toward the head, so its rounded nose has enough of them.
            position[v] = 1 - (1 - i / SEGMENTS) ** 2;
            position[v + 1] = s === 0 ? -1 : 1;
        }
        if (i < SEGMENTS) {
            const o = i * 2;
            index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
    }
    const positionAttr = new THREE.BufferAttribute(position, 3);
    const slots = new Float32Array(STREAKS);
    for (let i = 0; i < STREAKS; i += 1) slots[i] = i;
    const slotAttr = new THREE.InstancedBufferAttribute(slots, 1);
    const build = (mirrored) => {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setIndex(index);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('aStreak', slotAttr);
        geometry.instanceCount = STREAKS;
        const mesh = new THREE.Mesh(geometry, streakMaterial({
            u, noise, tier, mirrored,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 30 : 31;
        mesh.name = mirrored ? 'starlight-streaks-mirror' : 'starlight-streaks';
        return mesh;
    };
    const sky = build(false);
    const lake = build(true);
    const streaks = new THREE.Group();
    streaks.name = 'starlight-streaks';
    streaks.add(lake, sky);
    return {
        streaks,
        dispose() {
            [sky, lake].forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
        },
    };
}
