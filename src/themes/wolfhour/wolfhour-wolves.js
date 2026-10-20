/**
 * Wolfhour's wolves. Each wolf is one small quad whose shader unions the tapered capsules of its
 * rig (wolfhour-wolf-rig.js) smoothly into a single organic silhouette, roughens the outline into
 * fur with the sky's noise tile, and lights a hairline of moonlight along the edges that face the
 * moon (the union's own gradient gives the normal). A faint glint marks the eye.
 *
 * The pack (a lead, a sitter and a young wolf that paces the ridge) stands on the right-hand spur
 * looking left toward the moon. Across the valley a lone wolf sits on the left-hand spur and
 * answers when the pack howls. Now and then a scout walks in along the foreground ridge, stops to
 * look over the valley, and walks out again. A line clear makes the lead lift its head; a
 * four-line clear makes the pack howl at the moon, one after another, breath smoking in the cold.
 *
 * Every pose is a pure function of time (and of when the howls and glances began), so a seek or a
 * capture lands on the same frame. Rig units: a wolf faces +x with its paws on y = 0.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, attribute, clamp, dot, exp, float, fwidth, length, max, mix, positionGeometry,
    smoothstep, texture, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    CAPSULE_COUNT, CAPSULE_STRIDE, MAX_GROUND_SLOPE, WOLF_BOUNDS, poseWolf,
} from './wolfhour-wolf-rig.js';
import { makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/** Coat, moon rim and eye glint (linear, before the grade). */
const COAT = vec3(0.0045, 0.006, 0.0105);
const RIM = vec3(0.22, 0.27, 0.38);
const GLINT = vec3(0.42, 0.48, 0.58);
/** The moon's direction on screen (upper left), for the rim. */
const MOON_SCREEN = Object.freeze({ x: -0.62, y: 0.78 });

/* ── Who stands where, and how they behave ─────────────────────────────────────────── */

/**
 * The pack, in pack units from the lead's paws: its build, place, scale, resting head lift, howl
 * (head lift and how late it joins) and an idle phase so no two wolves breathe together.
 */
export const PACK = Object.freeze([
    Object.freeze({
        name: 'lead',
        build: 'standing',
        x: 0,
        sink: 0.2,
        scale: 1,
        facing: -1,
        head: 2,
        howl: 64,
        delay: 0,
        idlePhase: 0.3,
    }),
    Object.freeze({
        name: 'sitter',
        build: 'sitting',
        x: -40,
        sink: 0.2,
        scale: 0.94,
        facing: -1,
        head: 4,
        howl: 66,
        delay: 0.55,
        idlePhase: 2.1,
    }),
    Object.freeze({
        name: 'young',
        build: 'standing',
        x: 46,
        sink: 0.2,
        scale: 0.8,
        facing: -1,
        head: -4,
        howl: 58,
        delay: 1.05,
        idlePhase: 4.4,
    }),
]);

/** The wolf across the valley: sits facing the pack and answers a moment after the lead. */
export const ANSWERER = Object.freeze({
    name: 'answer',
    build: 'sitting',
    x: 0,
    sink: 0.2,
    scale: 1,
    facing: 1,
    head: 6,
    howl: 68,
    delay: 1.9,
    idlePhase: 5.7,
});

/** The scout's visits to the foreground ridge (scout units from its anchor; seconds). */
export const SCOUT = Object.freeze({
    name: 'scout',
    build: 'standing',
    sink: 0.2,
    scale: 1,
    head: 0,
    howl: 62,
    delay: 0.8,
    idlePhase: 1.3,
    /** From off screen to the right, to the lookout where it stops to look over the valley. */
    from: 190,
    to: -40,
    /** Units per second along the ridge. */
    speed: 16,
    /** The first arrival, the period between visits, and the pause at the lookout. */
    first: 18,
    period: 96,
    pause: 10,
});

/**
 * The young wolf's pacing (pack units, seconds): it steps a little way down the ridge away from the
 * lead (`toward` +1: right), looks along it, and climbs back to its place. The reach keeps it off
 * the ridge's steep far side (past about 80 pack units the crest falls at 35-40 degrees) and clear
 * of the lead, whose tail reaches 20 units behind it.
 */
export const PACE = Object.freeze({
    reach: 18, toward: 1, speed: 7, period: 27, look: 5,
});
/**
 * A walking wolf's stride (rig units): the distance its body travels per gait cycle. The gait is
 * read from the distance actually travelled, so a planted paw stays where it was put down.
 */
export const WALK_STRIDE = 15;

/** The howl's timing (seconds): the head rises, holds the note, and comes down. */
export const HOWL = Object.freeze({ rise: 0.6, hold: 2.6, fall: 1.0 });
/** A line clear's glance: the lead wolf lifts its head and looks again. */
const GLANCE = Object.freeze({
    rise: 0.35, hold: 1.0, fall: 0.7, angle: 22,
});
const HOWL_SPAN = HOWL.rise + HOWL.hold + HOWL.fall;
/** How long the young wolf's pacing stands still for a howl. */
const HOWL_STILL = HOWL_SPAN + 1.2;

const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

/** 0..1 envelope of an event that started `age` seconds ago (rise, hold, fall). */
export function eventEnvelope(age, { rise, hold, fall }) {
    if (!Number.isFinite(age) || age < 0) return 0;
    if (age < rise) return smooth(age / rise);
    if (age < rise + hold) return 1;
    return 1 - smooth((age - rise - hold) / fall);
}

/**
 * Where the scout is at `time`: x (scout units), facing, how far it has walked on this leg of its
 * visit, whether it walks, and how long it has paused at the lookout; null between visits. A pure
 * function of time.
 */
export function scoutAt(time) {
    const t = time - SCOUT.first;
    if (!Number.isFinite(t) || t < 0) return null;
    const local = t % SCOUT.period;
    const walk = (SCOUT.from - SCOUT.to) / SCOUT.speed;
    if (local < walk) {
        const d = local * SCOUT.speed;
        return {
            x: SCOUT.from - d, facing: -1, travel: d, moving: true, pause: 0,
        };
    }
    if (local < walk + SCOUT.pause) {
        return {
            x: SCOUT.to, facing: -1, travel: 0, moving: false, pause: local - walk,
        };
    }
    if (local < walk * 2 + SCOUT.pause) {
        const d = (local - walk - SCOUT.pause) * SCOUT.speed;
        return {
            x: SCOUT.to + d, facing: 1, travel: d, moving: true, pause: 0,
        };
    }
    return null;
}

/** The young wolf on its pacing clock: offset and distance walked on this leg (pack units), facing, moving. */
export function paceAt(clock) {
    const local = ((clock % PACE.period) + PACE.period) % PACE.period;
    const walk = PACE.reach / PACE.speed;
    const out = PACE.toward;
    if (local < walk) {
        const d = local * PACE.speed;
        return {
            dx: out * d, facing: out, travel: d, moving: true,
        };
    }
    if (local < walk + PACE.look) {
        return {
            dx: out * PACE.reach, facing: out, travel: 0, moving: false,
        };
    }
    if (local < walk * 2 + PACE.look) {
        const d = (local - walk - PACE.look) * PACE.speed;
        return {
            dx: out * (PACE.reach - d), facing: -out, travel: d, moving: true,
        };
    }
    // Back at its place, it turns to face the moon again.
    return {
        dx: 0, facing: -1, travel: 0, moving: false,
    };
}

/* ── The silhouette shader ─────────────────────────────────────────────────────────── */

function createWolfMaterial(noise, seed) {
    const rows = Array.from({ length: CAPSULE_COUNT * 2 }, () => new THREE.Vector4(1e4, 1e4, 1e4, 1e4));
    const capsules = uniformArray(rows, 'vec4');
    const uMoon = uniform(new THREE.Vector2(MOON_SCREEN.x, MOON_SCREEN.y));
    const uEye = uniform(new THREE.Vector3(0, 0, 0));
    const uFade = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour wolf',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const shape = Fn(() => {
        const p = positionGeometry.xy.toVar();
        const d = float(1e3).toVar();
        const g = vec2(0, 1).toVar();
        Loop(CAPSULE_COUNT, ({ i }) => {
            const a = capsules.element(i.mul(2)).toVar();
            const b = capsules.element(i.mul(2).add(1)).toVar();
            const pa = p.sub(a.xy).toVar();
            const ba = a.zw.sub(a.xy).toVar();
            const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-4)), 0, 1).toVar();
            const q = pa.sub(ba.mul(h)).toVar();
            const len = max(length(q), 1e-4).toVar();
            const dist = len.sub(mix(b.x, b.y, h)).toVar();
            // Smooth union, carrying its gradient: m is the weight the union so far keeps.
            const k = max(b.z, 1e-3);
            const m = clamp(float(0.5).add(dist.sub(d).mul(0.5).div(k)), 0, 1).toVar();
            d.assign(mix(dist, d, m).sub(k.mul(m).mul(float(1).sub(m))));
            g.assign(mix(q.div(len), g, m));
        });
        // Fur: the outline frays by about half a unit, in tufts a unit or two across.
        const fur = texture(noise, p.mul(0.045).add(vec2(seed, seed * 1.7))).r.mul(0.7)
            .add(texture(noise, p.mul(0.11).add(vec2(seed * 2.3, 0.4))).r.mul(0.3));
        const edge = d.add(fur.sub(0.5).mul(1.3)).toVar();
        const fw = max(fwidth(edge), 1e-3).toVar();
        const cover = float(1).sub(smoothstep(fw.negate(), fw, edge));
        // Moon rim: the outer band of the coat on the moon's side, about a pixel and a half wide.
        const facing = dot(g.normalize(), uMoon).toVar();
        const band = float(1).sub(smoothstep(0, fw.mul(1.7).max(0.6), edge.negate()));
        const rim = band.mul(smoothstep(0.38, 0.92, facing));
        const sheen = smoothstep(-5, 0, edge).mul(facing.max(0)).mul(0.25);
        const eyeOffset = p.sub(uEye.xy);
        const glint = exp(dot(eyeOffset, eyeOffset).mul(-2.6)).mul(uEye.z);
        const colour = COAT.mul(sheen.add(1)).add(RIM.mul(rim)).add(GLINT.mul(glint));
        return vec4(colour, cover.mul(uFade));
    })();
    material.colorNode = shape.rgb;
    material.opacityNode = shape.a;
    return {
        material, rows, uniforms: { uMoon, uEye, uFade },
    };
}

/** Breath vapour: soft round puffs, moonlit, fading as they rise and spread. */
function createVapour(capacity) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const alpha = new Float32Array(capacity);
    const alphaAttribute = new THREE.InstancedBufferAttribute(alpha, 1);
    alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPuff', alphaAttribute);
    const material = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour breath vapour', transparent: true, depthWrite: false,
    });
    const p = uv().sub(0.5).mul(2);
    const r2 = p.dot(p);
    material.colorNode = vec3(0.3, 0.36, 0.5);
    material.opacityNode = exp(r2.mul(-3.2)).mul(float(1).sub(r2).max(0)).mul(attribute('aPuff', 'float'));
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = 'Wolfhour breath vapour';
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One invisible puff is always drawn, so the scene's warm-up compiles the vapour before the
    // first howl rather than during it.
    mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(0.001, 0.001, 1));
    mesh.count = 1;
    return { mesh, alpha, alphaAttribute };
}

/* ── The wolves ────────────────────────────────────────────────────────────────────── */

/**
 * Creates the wolves (no renderer). `group` is the pack, its origin the lead's paws;
 * `answerer.group` and `scout.group` stand elsewhere. Each takes `settle(groundAt)`: the ridge's
 * height under any x of its own frame.
 */
export function createWolfhourPack({ quality = 'High', noiseMap = null } = {}) {
    const ownsNoise = !noiseMap;
    const noise = noiseMap || makeWolfhourNoiseTexture();
    const lowTier = quality === 'Minimal' || quality === 'Low';
    const [bx0, by0, bx1, by1] = WOLF_BOUNDS;
    const quad = new THREE.PlaneGeometry(bx1 - bx0, by1 - by0);
    quad.translate((bx0 + bx1) / 2, (by0 + by1) / 2, 0);
    const materials = [];

    const makeWolf = (spec, index) => {
        const { material, rows, uniforms } = createWolfMaterial(noise, 0.13 + index * 0.29);
        materials.push(material);
        const mesh = new THREE.Mesh(quad, material);
        mesh.name = `Wolfhour wolf (${spec.name})`;
        mesh.frustumCulled = false;
        return {
            spec,
            mesh,
            rows,
            uniforms,
            capsules: new Float32Array(CAPSULE_COUNT * CAPSULE_STRIDE),
            facing: spec.facing ?? -1,
            muzzle: [0, 0],
            visible: true,
        };
    };

    const group = new THREE.Group();
    group.name = 'Wolfhour pack';
    const wolves = PACK.map((spec, i) => makeWolf(spec, i));
    for (const wolf of wolves) group.add(wolf.mesh);
    const vapour = createVapour(lowTier ? 12 : 36);
    group.add(vapour.mesh);

    const answererGroup = new THREE.Group();
    answererGroup.name = 'Wolfhour answering wolf';
    const answerer = makeWolf(ANSWERER, 3);
    answererGroup.add(answerer.mesh);

    const scoutGroup = new THREE.Group();
    scoutGroup.name = 'Wolfhour scout';
    const scout = makeWolf(SCOUT, 4);
    scoutGroup.add(scout.mesh);

    const state = {
        howlStart: -Infinity, glanceStart: -Infinity, paused: 0, spread: 1, members: wolves.length,
    };
    const grounds = { pack: () => 0, answerer: () => 0, scout: () => 0 };
    const matrix = new THREE.Matrix4();
    const muzzle = new THREE.Vector3();

    const howlOf = (spec, t) => eventEnvelope(t - state.howlStart - spec.delay, HOWL);

    /** Head lift (degrees): breathing, a sniff at the wind now and then, glances and howls. */
    const headOf = (spec, t, m, howl, extra) => {
        const breath = Math.sin(t * 1.3 + spec.idlePhase) * 1.6 * m;
        const sniffPhase = (t + spec.idlePhase * 7) % 23;
        const sniff = sniffPhase > 17 ? Math.sin(((sniffPhase - 17) / 6) * Math.PI) * 26 * m : 0;
        const idle = spec.head + breath - sniff + extra;
        return idle + (spec.howl - idle) * howl;
    };

    /**
     * Pose one wolf into its uniforms at `x`, facing ±1, on the ridge `groundAt` describes (the
     * ridge's height under any x of the wolf's group). The wolf's frame sits on the ridge under its
     * middle; the rig reads the ridge under each paw, hip and shoulder from there.
     */
    const pose = (entry, t, m, {
        x, groundAt, facing, gait = 0, stride = 0, howl = 0, extra = 0, fade = 1, visible = true,
    }) => {
        const { spec, mesh } = entry;
        mesh.visible = visible;
        entry.visible = visible;
        if (!visible) return;
        const s = spec.scale;
        const base = groundAt(x);
        const reach = (WOLF_BOUNDS[3] - WOLF_BOUNDS[1]) * 0.2;
        // The ridge under the wolf, in its own (mirrored, scaled) frame, relative to its middle.
        const ridge = (rx) => {
            const h = (groundAt(x + facing * s * rx) - base) / s;
            const cap = Math.min(reach, Math.abs(rx) * MAX_GROUND_SLOPE);
            return Number.isFinite(h) ? Math.max(-cap, Math.min(cap, h)) : 0;
        };
        // An ear flicks back now and then.
        const flick = Math.max(0, Math.sin(t * 0.9 + spec.idlePhase * 3)) ** 40 * 14 * m;
        const rig = poseWolf({
            build: spec.build,
            gait,
            stride,
            head: headOf(spec, t, m, howl, extra),
            // The note wavers: the jaw works a little while it holds.
            jaw: howl * (13 + Math.sin(t * 6.3 + spec.idlePhase) * 2.5),
            tail: stride > 0
                ? Math.sin(gait * Math.PI * 2) * 6
                : Math.sin(t * 0.7 + spec.idlePhase) * 5 * m - howl * 8,
            breath: Math.sin(t * 1.3 + spec.idlePhase) * m,
            ears: howl * 14 + flick,
            ground: ridge,
        }, entry.capsules);
        for (let i = 0; i < CAPSULE_COUNT; i++) {
            const o = i * CAPSULE_STRIDE;
            const c = rig.capsules;
            entry.rows[i * 2].set(c[o], c[o + 1], c[o + 2], c[o + 3]);
            entry.rows[i * 2 + 1].set(c[o + 4], c[o + 5], c[o + 6], 0);
        }
        mesh.scale.set(facing * s, s, 1);
        mesh.position.set(x, base - spec.sink * s, 0.01 * s);
        // The moon is upper left on screen; a mirrored wolf sees it from its other side.
        entry.uniforms.uMoon.value.set(MOON_SCREEN.x * facing, MOON_SCREEN.y);
        entry.uniforms.uEye.value.set(rig.eye[0], rig.eye[1], 0.3 * (1 - howl * 0.7));
        entry.uniforms.uFade.value = fade;
        [entry.muzzle[0], entry.muzzle[1]] = rig.muzzle;
        entry.paws = rig.paws;
        entry.ridge = ridge;
        entry.facing = facing;
    };

    const placeVapour = (t) => {
        let count = 0;
        for (const entry of wolves) {
            if (!entry.visible) continue;
            const age = t - state.howlStart - entry.spec.delay;
            if (age < HOWL.rise * 0.6 || age > HOWL_SPAN + 2.2) continue;
            entry.mesh.updateWorldMatrix(true, false);
            muzzle.set(entry.muzzle[0], entry.muzzle[1], 0.3).applyMatrix4(entry.mesh.matrixWorld);
            group.worldToLocal(muzzle);
            const size0 = entry.spec.scale;
            // A puff leaves the muzzle every 0.4 s while the note is held and drifts up and ahead.
            for (let k = 0; k < 10 && count < vapour.alpha.length; k++) {
                const born = HOWL.rise * 0.6 + k * 0.4;
                if (born > HOWL.rise + HOWL.hold) break;
                const life = age - born;
                if (life >= 0 && life <= 2.2) {
                    const f = life / 2.2;
                    const size = (2.6 + f * 10) * size0;
                    matrix.makeScale(size, size, 1);
                    matrix.setPosition(
                        muzzle.x + (2 + f * 9) * entry.facing * size0,
                        muzzle.y + (1 + f * 13) * size0,
                        muzzle.z + 0.2,
                    );
                    vapour.mesh.setMatrixAt(count, matrix);
                    vapour.alpha[count] = 0.6 * Math.sin(Math.min(1, f * 4) * Math.PI * 0.5) * (1 - f) ** 1.5;
                    count += 1;
                }
            }
        }
        if (count === 0) {
            if (vapour.alpha[0] === 0 && vapour.mesh.count === 1) return;
            vapour.alpha[0] = 0;
            count = 1;
        }
        vapour.mesh.count = count;
        vapour.mesh.instanceMatrix.needsUpdate = true;
        vapour.alphaAttribute.needsUpdate = true;
    };

    return {
        group,
        wolves,
        answerer: {
            group: answererGroup,
            wolf: answerer,
            settle(groundAt) { grounds.answerer = groundAt; },
        },
        scout: {
            group: scoutGroup,
            wolf: scout,
            settle(groundAt) { grounds.scout = groundAt; },
        },
        /**
         * Rest the pack on the ridge: `groundAt(x)` gives the ridge's height at pack x. `spread`
         * (0..1) draws it together on a narrow screen; `members` shows only the first wolves.
         */
        settle(groundAt, { spread = 1, members = wolves.length } = {}) {
            grounds.pack = groundAt;
            state.spread = Number.isFinite(spread) ? Math.min(1, Math.max(0.3, spread)) : 1;
            state.members = members;
        },
        /** A four-line clear: the pack howls. Ignored while a howl is still sounding. */
        howl(time) {
            if (!Number.isFinite(time)) return false;
            if (time - state.howlStart < (HOWL_SPAN + 1.05) * 0.8) return false;
            // The young wolf's pacing clock stood still through the last howl.
            const last = Math.min(time - state.howlStart, HOWL_STILL);
            if (Number.isFinite(last)) state.paused += Math.max(0, last);
            state.howlStart = time;
            return true;
        },
        /** A smaller clear: the lead wolf lifts its head. */
        glance(time) {
            if (Number.isFinite(time)) state.glanceStart = time;
        },
        /** How strongly the pack is howling now (0..1): drives the mist and the moon's answer. */
        howlLevel(time) {
            let level = 0;
            for (const entry of wolves) level = Math.max(level, howlOf(entry.spec, time));
            return level;
        },
        /** Where the scout is now (null between its visits or under reduced motion). */
        scoutAt,
        /** Pose every wolf at `time`. `motion` (0..1) scales idle movement; below 0.5 nobody walks. */
        update(time, motion = 1) {
            const t = Number.isFinite(time) ? time : 0;
            const m = Number.isFinite(motion) ? Math.min(1, Math.max(0, motion)) : 1;
            const walking = m >= 0.5;
            wolves.forEach((entry, i) => {
                const { spec } = entry;
                const howl = howlOf(spec, t);
                const glance = spec.name === 'lead' ? eventEnvelope(t - state.glanceStart, GLANCE) * GLANCE.angle : 0;
                let x = spec.x * state.spread;
                let { facing } = spec;
                let gait = 0;
                let stride = 0;
                if (spec.name === 'young' && walking) {
                    const clock = t - state.paused - Math.max(0, Math.min(t - state.howlStart, HOWL_STILL));
                    const pace = paceAt(clock);
                    x += pace.dx * state.spread;
                    if (howl < 0.05) {
                        ({ facing } = pace);
                        // Its own steps: the distance walked in its rig units, one cycle a stride.
                        gait = (pace.travel * state.spread) / (WALK_STRIDE * spec.scale);
                        stride = pace.moving ? WALK_STRIDE : 0;
                    }
                }
                pose(entry, t, m, {
                    x,
                    groundAt: grounds.pack,
                    facing,
                    gait,
                    stride,
                    howl,
                    extra: glance * (1 - howl),
                    visible: i < state.members,
                });
            });
            pose(answerer, t, m, {
                x: 0, groundAt: grounds.answerer, facing: ANSWERER.facing, howl: howlOf(ANSWERER, t),
            });
            const walk = walking ? scoutAt(t) : null;
            if (walk) {
                // It fades in and out at the frame's edge rather than popping, looks round at its
                // lookout, and howls with the pack if it is standing there.
                const looking = walk.moving ? 0 : Math.sin(Math.min(1, walk.pause / SCOUT.pause) * Math.PI) * 10;
                pose(scout, t, m, {
                    x: walk.x,
                    groundAt: grounds.scout,
                    facing: walk.facing,
                    gait: walk.travel / (WALK_STRIDE * SCOUT.scale),
                    stride: walk.moving ? WALK_STRIDE : 0,
                    howl: walk.moving ? 0 : howlOf(SCOUT, t),
                    extra: looking,
                    fade: smooth((SCOUT.from - walk.x) / 30),
                });
            } else {
                pose(scout, t, m, {
                    x: SCOUT.from, groundAt: grounds.scout, facing: -1, visible: false,
                });
            }
            placeVapour(t);
        },
        dispose() {
            group.removeFromParent();
            answererGroup.removeFromParent();
            scoutGroup.removeFromParent();
            quad.dispose();
            for (const material of materials) material.dispose();
            vapour.mesh.geometry.dispose();
            vapour.mesh.material.dispose();
            vapour.mesh.dispose();
            if (ownsNoise) noise.dispose();
            group.clear();
            answererGroup.clear();
            scoutGroup.clear();
        },
    };
}
