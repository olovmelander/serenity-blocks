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
 * The horse is authored and rigged in Blender (scripts/blender/grainfields/horse.py, loaded by
 * grainfields-assets.js as `assets.horse`): one mesh skinned to thirty-eight bones. Each horse's
 * motion (grainfields-horse-motion.js: hooves planted where they strike, legs folding in the air,
 * the back, neck, jaw, ears and tail) poses its skeleton every frame (grainfields-horse-rig.js),
 * and the pose goes up as a table of bones, a rotation and a translation each, that the vertex
 * stage blends four to a vertex. The mane, the forelock and the tail's ends move a little more
 * on their own, in the wind and the air the horse runs through. What the horses kick up (the dust of
 * their hooves, the chaff they breast out of the ears, the awns a grazing horse scatters) is
 * grainfields-herd-dust.js's, thrown here from the motion's own strikes and tears.
 *
 * Unlit, lit by the shared light: the coat (each horse's own colour, its points, mane and tail,
 * a dun's stripe down its back) by the sun through the deck and the sky, softened where the
 * hair scatters it and darkened in its own hollows, a sheen on the coat, a rim of light round the
 * silhouette when the sun is behind it, eyes and nostrils drawn finer than the mesh, then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    cross,
    dot,
    float,
    floor,
    instanceIndex,
    int,
    length,
    max,
    mix,
    normalize,
    pow,
    positionGeometry,
    positionWorld,
    select,
    sin,
    smoothstep,
    texture,
    uniformArray,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { groundHeight } from './grainfields-plan.js';
import { aerial } from './grainfields-light.js';
import { deckShadow } from './grainfields-tsl.js';
import { HERD, createHerdSim } from './grainfields-herd-sim.js';
import {
    SKIN_ROWS, boneToWorld, createRig, writeSkinRows,
} from './grainfields-horse-rig.js';
import { createHorseMotion, stepHorseMotion } from './grainfields-horse-motion.js';
import { CHAFF, DUST, createHerdDust } from './grainfields-herd-dust.js';
import { mulberry32, smooth } from './grainfields-core.js';

export { HERD };

/**
 * Coats (linear): the body, the mane and tail, the legs' points, how pale the belly and muzzle go,
 * and the hooves' horn. Bay, chestnut (a flaxen mane, no black points), dun (a dark stripe down its
 * back), grey, black-bay (a brown muzzle).
 */
export const COATS = Object.freeze([
    Object.freeze({
        name: 'bay',
        body: [0.105, 0.05, 0.022],
        hair: [0.012, 0.009, 0.007],
        points: [0.014, 0.01, 0.008],
        light: 1.28,
        hoof: [0.03, 0.027, 0.024],
    }),
    Object.freeze({
        name: 'chestnut',
        body: [0.17, 0.065, 0.025],
        hair: [0.25, 0.13, 0.05],
        points: [0.13, 0.05, 0.02],
        light: 1.2,
        hoof: [0.09, 0.07, 0.05],
    }),
    Object.freeze({
        name: 'dun',
        body: [0.3, 0.21, 0.11],
        hair: [0.035, 0.025, 0.017],
        points: [0.045, 0.032, 0.022],
        light: 1.1,
        hoof: [0.035, 0.03, 0.026],
    }),
    Object.freeze({
        name: 'grey',
        body: [0.3, 0.292, 0.28],
        hair: [0.33, 0.32, 0.31],
        points: [0.12, 0.115, 0.11],
        light: 1.1,
        hoof: [0.05, 0.047, 0.045],
    }),
    Object.freeze({
        name: 'black-bay',
        body: [0.052, 0.033, 0.024],
        hair: [0.01, 0.008, 0.007],
        points: [0.011, 0.009, 0.008],
        light: 2.2,
        hoof: [0.028, 0.025, 0.022],
    }),
]);
/** Which coat has the dark stripe down its back, and which is dappled. */
const DUN = 2;
const GREY = 3;

/** v turned by the unit quaternion q. */
const turn = (q, v) => v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2.0));

/** The coat's colours for coat index k (a select chain over the table). */
function coatColours(k) {
    const pick = (key) => {
        const out = vec3(...COATS[0][key]).toVar();
        for (let i = 1; i < COATS.length; i++) out.assign(select(k.greaterThan(i - 0.5), vec3(...COATS[i][key]), out));
        return out;
    };
    const light = float(COATS[0].light).toVar();
    for (let i = 1; i < COATS.length; i++) light.assign(select(k.greaterThan(i - 0.5), float(COATS[i].light), light));
    return {
        body: pick('body'), hair: pick('hair'), points: pick('points'), hoof: pick('hoof'), light,
    };
}

function herdMaterial(u, t, rig, landmarks, bones, info) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsHerd';
    material.fog = false;
    const stride = rig.count * SKIN_ROWS;
    const paint = attribute('color', 'vec4'); // hair, points, light, occlusion
    const marks = attribute('_mask', 'vec4'); // hoof, dark skin, the hair's freedom, the inside of the ears
    const boneIds = attribute('_bones', 'vec4'); // four bone indices / 255
    const boneWeights = attribute('_weights', 'vec4');
    const vN = varying(vec3(0.0, 1.0, 0.0), 'gfHerdNormal');
    const vPaint = varying(vec4(0.0), 'gfHerdPaint');
    const vMarks = varying(vec4(0.0), 'gfHerdMarks');
    const vRest = varying(vec4(0.0), 'gfHerdRest'); // rest position, sunlit
    const vCoat = varying(vec2(0.0), 'gfHerdCoat'); // coat, seed
    material.positionNode = Fn(() => {
        const horse = int(instanceIndex);
        const base = horse.mul(stride).toVar();
        const coat = info.element(horse.mul(2)); // coat, the hair's flow (x, y, z)
        const place = info.element(horse.mul(2).add(1)); // where it stands (x, ground y, z), its seed
        const p = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();
        const pos = vec3(0.0).toVar();
        const nor = vec3(0.0).toVar();
        const ids = [boneIds.x, boneIds.y, boneIds.z, boneIds.w];
        const ws = [boneWeights.x, boneWeights.y, boneWeights.z, boneWeights.w];
        for (let k = 0; k < 4; k++) {
            const row = base.add(int(floor(ids[k].mul(255.0).add(0.5))).mul(SKIN_ROWS)).toVar();
            const q = bones.element(row).toVar();
            const tr = bones.element(row.add(1)).toVar();
            pos.addAssign(turn(q, p).mul(tr.w).add(tr.xyz).mul(ws[k]));
            nor.addAssign(turn(q, nrm).mul(ws[k]));
        }
        // The hair's own motion: carried by the wind and the air the horse runs through, and
        // rippling, the more the farther from its roots.
        const free = marks.z.mul(marks.z);
        const flow = coat.yzw;
        const ph = place.w.mul(37.0);
        const ripple = vec3(
            sin(u.time.mul(6.3).add(p.y.mul(9.0)).add(p.z.mul(7.0)).add(ph)),
            sin(u.time.mul(4.1).add(p.z.mul(11.0)).add(ph)).mul(0.5),
            cos(u.time.mul(5.7).add(p.y.mul(8.0)).add(ph)),
        ).mul(length(flow).add(0.35).mul(0.018));
        pos.addAssign(flow.mul(0.12).add(ripple).mul(free));
        vN.assign(normalize(nor));
        vPaint.assign(paint);
        vMarks.assign(marks);
        vCoat.assign(vec2(coat.x, place.w));
        vRest.assign(vec4(p, deckShadow(u, t.noise, place.xyz.add(vec3(0.0, 1.5, 0.0))).mul(u.sunUp)));
        return pos;
    })();
    const eyes = landmarks.eyes || [];
    const nostrils = landmarks.nostrils || [];
    const forward = vec3(...(landmarks.headForward || [0, -0.743, 0.669]));
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const N = normalize(vN).toVar();
        const rest = vRest.xyz.toVar();
        const k = floor(vCoat.x.add(0.5)).toVar();
        const C = coatColours(k);
        const hair = vPaint.x;
        const points = vPaint.y;
        const pale = vPaint.z;
        const ao = vPaint.w;
        // The coat: never one flat colour (broad shades of its own, read in the horse's rest frame so
        // they ride with it), a grey's dapples, a shade darker along the top line; paler on the belly
        // and the muzzle, its points and its hair.
        const side = vec2(rest.z, rest.y).add(vCoat.y.mul(7.3));
        const broad = texture(t.noise, side.mul(0.55)).level(1);
        const body = C.body.mul(broad.r.mul(0.3).add(0.85)).mul(float(1.0).sub(smoothstep(1.02, 1.3, rest.y).mul(0.12)))
            .toVar();
        // A grey's dapples: soft paler rounds in a darker net over the barrel and the quarters.
        const dapple = smoothstep(0.32, 0.72, texture(t.noise, side.mul(1.7).add(rest.x)).level(2).g)
            .mul(smoothstep(0.55, 0.8, rest.y)).mul(float(1.0).sub(smoothstep(0.45, 0.75, rest.z)));
        body.assign(select(k.equal(float(GREY)), body.mul(dapple.mul(0.32).add(0.84)), body));
        const albedo = mix(body, body.mul(C.light), pale).toVar();
        albedo.assign(mix(albedo, C.points, points));
        albedo.assign(mix(albedo, C.hair, hair));
        // A dun's dark stripe down the middle of its back, from the withers to the tail.
        const stripe = float(1.0).sub(smoothstep(0.014, 0.03, abs(rest.x)))
            .mul(smoothstep(1.17, 1.23, rest.y)).mul(smoothstep(-0.95, -0.82, rest.z))
            .mul(float(1.0).sub(smoothstep(0.28, 0.42, rest.z)));
        albedo.assign(mix(albedo, C.hair.mul(1.4), stripe.mul(select(k.equal(float(DUN)), float(0.85), float(0.0)))));
        // The dark skin of the nostrils and lips, the inside of the ears, the horn of the hooves.
        let nostril = float(0.0);
        nostrils.forEach((n) => {
            const d = length(rest.sub(vec3(...n)).mul(vec3(1.0, 1.3, 1.6)));
            nostril = max(nostril, float(1.0).sub(smoothstep(0.009, 0.017, d)));
        });
        const skin = max(vMarks.y, nostril);
        albedo.assign(mix(albedo, vec3(0.022, 0.018, 0.017), skin));
        albedo.assign(albedo.mul(float(1.0).sub(vMarks.w.mul(0.65))));
        albedo.assign(mix(albedo, C.hoof, vMarks.x));
        // The eyes: a dark almond, longer along the face than across it.
        let eye = float(0.0);
        eyes.forEach((e) => {
            const d = rest.sub(vec3(...e));
            const along = dot(d, forward);
            const r = length(d.sub(forward.mul(along)).add(forward.mul(along.mul(0.72))));
            eye = max(eye, float(1.0).sub(smoothstep(0.015, 0.022, r)));
        });
        albedo.assign(mix(albedo, vec3(0.008, 0.006, 0.005), eye));

        const sunlit = vRest.w;
        // Hair scatters the light round the terminator: a softened Lambert.
        const ndl = clamp(dot(N, u.sunDir).add(0.3).div(1.3), 0.0, 1.0);
        const direct = u.sun.mul(ndl.mul(ndl)).mul(sunlit).mul(mix(float(1.0), ao, 0.5));
        const sky = u.fill.mul(N.y.mul(0.4).add(0.6)).mul(1.4).add(u.bounce.mul(float(1.0).sub(N.y).mul(0.4)))
            .mul(ao.mul(ao));
        const col = albedo.mul(direct.add(sky)).toVar();
        // A sheen on the coat (less on the hair), and the wet glint of an eye.
        const H = normalize(u.sunDir.sub(V));
        const nh = clamp(dot(N, H), 0.0, 1.0);
        // (A dark coat shines the more: what little it gives back is mostly sheen.)
        const gloss = float(0.05).add(float(0.06).mul(float(1.0).sub(smoothstep(0.05, 0.2, body.g))));
        const sheen = pow(nh, float(18.0)).mul(gloss.mul(float(1.0).sub(hair.mul(0.6))).add(eye.mul(1.6)));
        col.addAssign(u.sun.mul(sunlit).mul(sheen).mul(ao));
        col.addAssign(u.fill.mul(eye).mul(pow(clamp(N.y.mul(0.5).add(0.5), 0.0, 1.0), float(4.0))).mul(0.6));
        // Backlit, a rim of light runs round the silhouette (the coat's hairs lit through).
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const edge = float(1.0).sub(clamp(dot(N, V.negate()), 0.0, 1.0));
        const e2 = edge.mul(edge);
        // (The hair's own glow, a little warmer than the coat under it: dark coats shine too.)
        col.addAssign(u.sun.mul(sunlit).mul(e2.mul(e2)).mul(ahead.mul(ahead)).mul(albedo.mul(0.6).add(hair.mul(0.03))
            .add(0.06))
            .mul(1.8));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

/** Ease the horses' poses on in steps no longer than this (seconds): the springs and the legs keep up. */
const MOTION_STEP = 1 / 30;

/** Where the muzzle is in the rest pose when the asset does not say (horse frame, metres). */
const MUZZLE = Object.freeze([0, 1.265, 1.408]);

/**
 * The herd: `count` horses (tier.herd) from the authored horse (`horse` = assets.horse:
 * { geometry, skeleton, landmarks }), `dust` records of what they kick up. Returns null without a
 * horse.
 */
export function createHerd(u, t, count, horse, { seed, dust: dustCount = 384 } = {}) {
    if (!horse?.geometry || !horse.skeleton) return null;
    const rig = createRig(horse.skeleton);
    const sim = createHerdSim({ count, seed });
    const n = sim.horses.length;
    const landmarks = horse.landmarks || {};
    const motions = sim.horses.map((h) => createHorseMotion(rig, {
        seed: h.seed, lead: h.seed < 0.5 ? 1 : -1, landmarks,
    }));
    const instanced = new THREE.InstancedBufferGeometry();
    ['position', 'normal', 'color', '_mask'].forEach((name) => {
        instanced.setAttribute(name, horse.geometry.attributes[name]);
    });
    // The bone indices are read as normalised bytes (one format on both backends) and scaled back.
    ['_bones', '_weights'].forEach((name) => {
        const a = horse.geometry.attributes[name];
        instanced.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, true));
    });
    instanced.setIndex(horse.geometry.index);
    instanced.instanceCount = n;
    const rows = Array.from({ length: Math.max(1, n) * rig.count * SKIN_ROWS }, () => ({
        x: 0, y: 0, z: 0, w: 1,
    }));
    const infoRows = Array.from({ length: Math.max(1, n) * 2 }, () => ({
        x: 0, y: 0, z: 0, w: 0,
    }));
    const bones = uniformArray(rows, 'vec4');
    const info = uniformArray(infoRows, 'vec4');
    const material = herdMaterial(u, t, rig, landmarks, bones, info);
    const mesh = new THREE.Mesh(instanced, material);
    mesh.name = 'GrainfieldsHerd';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    const wind = { windX: 0, windZ: 0 };
    let clock = 0;
    const dust = createHerdDust(u, t, dustCount);
    const dustSeed = ((seed ?? 0x40e5) ^ 0xd0571) >>> 0;
    let rand = mulberry32(dustSeed);
    const muzzle = landmarks.muzzle || MUZZLE;
    const spot = [0, 0, 0];

    /** What each horse kicked up since the last step: dust from its hooves, chaff from the ears. */
    const stir = (dt) => {
        sim.horses.forEach((h, i) => {
            const m = motions[i];
            const s = m.place.scale;
            const speed = h.speed || 0;
            const fx = Math.sin(h.heading);
            const fz = Math.cos(h.heading);
            m.events.forEach((e) => {
                if (e.kind === 'strike' && speed > 2) {
                    // A puff of the field's dry soil up through the barley; two at a hard gallop.
                    const hard = smooth(2, 10, speed);
                    const puffs = rand() < hard ? 2 : 1;
                    for (let k = 0; k < puffs; k++) {
                        const aside = (rand() - 0.5) * 0.8;
                        dust.kick({
                            x: e.x + (rand() - 0.5) * 0.3,
                            y: e.y + 0.35 + rand() * 0.3,
                            z: e.z + (rand() - 0.5) * 0.3,
                            vx: -fx * speed * 0.18 + fz * aside,
                            vy: 0.4 + rand() * (0.6 + hard),
                            vz: -fz * speed * 0.18 - fx * aside,
                            life: 2.2 + rand() * 1.6,
                            size: 0.16 * s,
                            grow: (0.5 + 0.7 * hard) * s,
                            kind: DUST,
                            time: e.time,
                            seed: rand(),
                        });
                    }
                } else if (e.kind === 'tear') {
                    // Awns and husks scattered from the mouthful torn away.
                    boneToWorld(rig, m.pose, rig.index.head, muzzle, s, spot);
                    for (let k = 0; k < 3; k++) {
                        dust.kick({
                            x: spot[0],
                            y: spot[1],
                            z: spot[2],
                            vx: (rand() - 0.5) * 0.7,
                            vy: 0.2 + rand() * 0.5,
                            vz: (rand() - 0.5) * 0.7,
                            life: 1.4 + rand(),
                            size: 0.011,
                            kind: CHAFF,
                            time: e.time,
                            seed: rand(),
                        });
                    }
                }
            });
            m.events.length = 0;
            // Breasting the ripe ears knocks husks loose, a shower of them at a gallop.
            let throws = (2 * smooth(0.8, 3.5, speed) + 12 * smooth(4.5, 11, speed)) * s * dt;
            while (throws > 0) {
                if (rand() < Math.min(1, throws)) {
                    const aside = (rand() - 0.5) * 2;
                    dust.kick({
                        x: m.place.x + fx * 0.75 * s + fz * aside * 0.15,
                        y: m.place.y - 0.05 * s + rand() * 0.15,
                        z: m.place.z + fz * 0.75 * s - fx * aside * 0.15,
                        vx: fx * speed * 0.45 + fz * aside,
                        vy: 0.5 + rand() * 0.9,
                        vz: fz * speed * 0.45 - fx * aside,
                        life: 1.6 + rand(),
                        size: 0.012,
                        kind: CHAFF,
                        time: clock,
                        seed: rand(),
                    });
                }
                throws -= 1;
            }
        });
        dust.update();
    };

    /** How hard each stage of browsing the ears pulls them toward the muzzle (chewing lets them go). */
    const PULL = Object.freeze({
        reach: 0.35, bite: 0.75, tear: 1, chew: 0,
    });
    const pulls = motions.map(() => 0);
    /** The muzzles at work in the barley, for the ears to answer (u.muzzles, the live ones first). */
    const writeMuzzles = (dt) => {
        let live = 0;
        let cx = 0;
        let cz = 0;
        sim.horses.forEach((h, i) => {
            const m = motions[i];
            const browsing = (h.business === 'graze' || h.business === 'step') && (h.speed || 0) < 0.5 && !h.verge
                && (h.alert || 0) < 0.3;
            const want = browsing ? PULL[m.eat.stage] ?? 0 : 0;
            const rate = want > pulls[i] ? 10 : 6;
            pulls[i] += (want - pulls[i]) * (1 - Math.exp(-rate * dt));
            if (pulls[i] < 0.02 || live >= u.tables.muzzles.length) return;
            boneToWorld(rig, m.pose, rig.index.head, muzzle, m.place.scale, spot);
            u.tables.muzzles[live].set(spot[0], spot[1], spot[2], pulls[i]);
            cx += spot[0];
            cz += spot[2];
            live += 1;
        });
        u.muzzleCount.value = live;
        for (let k = live; k < u.tables.muzzles.length; k++) u.tables.muzzles[k].set(0, 0, 0, 0);
        if (!live) {
            u.muzzleBounds.value.set(0, 0, 0);
            return;
        }
        cx /= live;
        cz /= live;
        let reach = 0;
        for (let k = 0; k < live; k++) {
            const row = u.tables.muzzles[k];
            reach = Math.max(reach, Math.hypot(row.x - cx, row.z - cz));
        }
        u.muzzleBounds.value.set(cx, cz, reach + 0.8);
    };

    const write = () => {
        sim.horses.forEach((h, i) => {
            const m = motions[i];
            writeSkinRows(rig, m.pose, m.place.scale, rows, i * rig.count * SKIN_ROWS);
            const a = infoRows[i * 2];
            a.x = h.coat;
            a.y = m.flow[0];
            a.z = m.flow[1];
            a.w = m.flow[2];
            const b = infoRows[i * 2 + 1];
            b.x = h.x;
            b.y = groundHeight(h.x, h.z);
            b.z = h.z;
            b.w = h.seed;
        });
    };
    /**
     * Every horse's motion on by `dt` (in short steps); one moved farther than it could walk (a
     * capture's lineup, a seek) starts over where it stands.
     */
    const move = (time, dt) => {
        const steps = Math.max(1, Math.ceil(dt / MOTION_STEP - 1e-6));
        const h = dt / steps;
        for (let s = 0; s < steps; s++) {
            const at = time - dt + h * (s + 1);
            sim.horses.forEach((one, i) => {
                const m = motions[i];
                const jump = Math.hypot(one.x - m.place.x, one.z - m.place.z);
                if (m.started && jump > 2 + one.speed * h * 2) m.started = false;
                stepHorseMotion(m, one, groundHeight, h, at, wind);
            });
            clock = at;
            stir(h);
        }
        clock = time;
    };
    move(0, 0);
    write();

    return {
        mesh,
        meshes: [mesh, dust.mesh],
        sim,
        dust,
        rig,
        motions,
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
        /** A seek: the band's life replayed up to `time`, its last seconds in full steps. */
        reset(time = 0) {
            const warm = Math.min(time, 4);
            sim.reset(time - warm);
            dust.reset();
            rand = mulberry32(dustSeed);
            pulls.fill(0);
            motions.forEach((m) => {
                m.started = false;
                m.events.length = 0;
            });
            move(time - warm, 0);
            for (let at = time - warm; at < time - 1e-6;) {
                const step = Math.min(MOTION_STEP, time - at);
                at += step;
                sim.update(at, step);
                move(at, step);
                writeMuzzles(step);
            }
            write();
        },
        update(time, dt, world) {
            const w = world?.u;
            if (w) {
                const strength = w.windStrength.value;
                wind.windX = w.windDir.value.x * strength * 3;
                wind.windZ = w.windDir.value.y * strength * 3;
            }
            sim.update(time, dt);
            const step = Math.max(0, Math.min(0.25, dt || time - clock));
            move(time, step);
            write();
            writeMuzzles(step);
        },
        dispose() {
            instanced.dispose();
            material.dispose();
            dust.dispose();
        },
    };
}
