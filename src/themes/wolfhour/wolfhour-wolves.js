/**
 * Wolfhour's wolves. Each wolf is one small quad whose shader unions the tapered capsules of its
 * rig (wolfhour-wolf-rig.js) smoothly into a single organic silhouette, roughens the outline into
 * fur with the sky's noise tile, and lights a hairline of moonlight along the edges that face the
 * moon (the union's own gradient gives the normal). Faint glints mark the eyes.
 *
 * The pack (a lead, a sitter and a young wolf) stands on the right-hand spur looking left toward
 * the moon; across the valley a lone wolf sits on the left-hand spur; now and then a scout walks
 * in along the foreground ridge, stops at a lookout (looks over the valley, sniffs the snow, lifts
 * a paw to listen, looks at you with a tilt of its head and back over its shoulder), turns round
 * and trots away. Each lives through its own repertoire (wolfhour-wolf-behaviour.js): the lead
 * looks round, yawns, shakes the snow off, stretches, sits, scratches, listens, circles and lies
 * down; the sitter lies down and rests its head, scratches; the young one paces, plays, digs and
 * hunts mice under the snow with a nose-first pounce. A wolf turns round through a view of its
 * face rather than flipping, sits down haunches first and walks its forepaws out to lie down. They
 * blink, and their breath smokes in the cold.
 *
 * Gameplay: a line clear makes the pack turn to look at you; a combo excites the young wolf (a
 * play bow, a wagging tail); a four-line clear makes the pack howl at the moon, one after another,
 * breath smoking (lying wolves sit up for it; a wolf in mid-pounce stays on the hunt), and the wolf
 * across the valley answers.
 *
 * Every pose is a pure function of time (and of when the howls, glances and excitements began),
 * so a seek or a capture lands on the same frame. Rig units: a wolf faces +x with paws on y = 0.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, attribute, clamp, dot, exp, float, fwidth, length, max, mix, positionGeometry,
    smoothstep, texture, uniform, uniformArray, uv, vec2, vec3, vec4,
} from 'three/tsl';
import {
    CAPSULE_COUNT, CAPSULE_STRIDE, MAX_GROUND_SLOPE, WOLF_BOUNDS, poseWolf,
} from './wolfhour-wolf-rig.js';
import {
    REPERTOIRES, TURN, YOUNG_MOVES, behaviourAt, busyAt, glide, glidePace,
} from './wolfhour-wolf-behaviour.js';
import { makeWolfhourNoiseTexture } from './wolfhour-sky.js';

/** Coat, moon rim and eye glint (linear, before the grade). */
const COAT = vec3(0.0045, 0.006, 0.0105);
const RIM = vec3(0.22, 0.27, 0.38);
const GLINT = vec3(0.42, 0.48, 0.58);
/** The moon's direction on screen (upper left), for the rim. */
const MOON_SCREEN = Object.freeze({ x: -0.62, y: 0.78 });

/* ── Who stands where ──────────────────────────────────────────────────────────────── */

/**
 * The pack, in pack units from the lead's paws: its role (its repertoire), place, scale, resting
 * head lift, howl (head lift and how late it joins) and an idle phase so no two breathe together.
 */
export const PACK = Object.freeze([
    Object.freeze({
        name: 'lead',
        role: 'lead',
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
        role: 'sitter',
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
        role: 'young',
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
    role: 'answer',
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
    sink: 0.2,
    scale: 1,
    head: 0,
    howl: 62,
    delay: 0.8,
    idlePhase: 1.3,
    /** From off screen to the right, to the lookout where it stops to look over the valley. */
    from: 190,
    to: -40,
    /** Walking in and trotting out (units per second along the ridge). */
    speed: 16,
    trotSpeed: 30,
    /** The first arrival, the period between visits, and the pause at the lookout. */
    first: 18,
    period: 96,
    pause: 12,
    /** How long it takes to get up to speed and to slow to a stop (seconds). */
    ramp: 0.8,
});

/**
 * Strides (rig units): the distance the body travels per gait cycle, walking and trotting. The
 * gait is read from the distance actually travelled, so a planted paw stays where it was put down.
 */
export const WALK_STRIDE = 15;
export const TROT_STRIDE = 22;

/** The howl's timing (seconds): the head rises, holds the note, and comes down. */
export const HOWL = Object.freeze({ rise: 0.6, hold: 2.6, fall: 1.0 });
/** A line clear's glance: the pack turns to look at you. */
const GLANCE = Object.freeze({ rise: 0.4, hold: 1.6, fall: 0.8 });
/** A combo's excitement: the young wolf bows, wags and bounces. */
const EXCITE = Object.freeze({ rise: 0.35, hold: 2.6, fall: 0.7 });
const EXCITE_SPAN = EXCITE.rise + EXCITE.hold + EXCITE.fall;
const HOWL_SPAN = HOWL.rise + HOWL.hold + HOWL.fall;
/** How long a moving wolf's behaviour stands still for a howl it joins. */
const HOWL_STILL = HOWL_SPAN + 1.2;
/** Snow puffs: how long one lives (seconds). */
const PUFF_LIFE = 1.6;
/** A breath in the cold: how long a puff lives (seconds) and how dense it is. */
const BREATH = Object.freeze({ life: 2.2, alpha: 0.16 });
/** How fast a wolf breathes (radians per second): a breath every 4.8 s. */
const BREATH_RATE = 1.3;

const smooth = (t) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};
const span = (u, from, to, ramp) => Math.min(smooth((u - from) / ramp), 1 - smooth((u - (to - ramp)) / ramp));

/** A blink, 0..1: about every five seconds the eyes close for a sixth of a second. */
export function blinkAt(t, phase = 0) {
    const period = 4.4 + phase * 0.35;
    const k = Math.floor((t + phase * 3.1) / period);
    const jitter = (Math.abs(Math.sin(k * 12.9898 + phase * 78.233)) * 43758.5453) % 1;
    const centre = k * period - phase * 3.1 + 0.3 + jitter * (period - 0.6);
    return 1 - smooth((Math.abs(t - centre) - 0.05) / 0.06);
}

/** 0..1 envelope of an event that started `age` seconds ago (rise, hold, fall). */
export function eventEnvelope(age, { rise, hold, fall }) {
    if (!Number.isFinite(age) || age < 0) return 0;
    if (age < rise) return smooth(age / rise);
    if (age < rise + hold) return 1;
    return 1 - smooth((age - rise - hold) / fall);
}

/**
 * Where the scout is at `time`: x (scout units), facing, how far it has moved on this leg of its
 * visit, whether it moves and how (it walks in and trots out), and how long it has paused at the
 * lookout; null between visits. A pure function of time.
 */
export function scoutAt(time) {
    const t = time - SCOUT.first;
    if (!Number.isFinite(t) || t < 0) return null;
    const local = t % SCOUT.period;
    const distance = SCOUT.from - SCOUT.to;
    const { ramp } = SCOUT;
    const walk = distance / SCOUT.speed + ramp;
    const trot = distance / SCOUT.trotSpeed + ramp;
    if (local < walk) {
        const d = glide(local, distance, SCOUT.speed, ramp);
        return {
            x: SCOUT.from - d,
            facing: -1,
            travel: d,
            walked: local * SCOUT.speed,
            pace: glidePace(local, distance, SCOUT.speed, ramp),
            moving: true,
            gaitKind: 'walk',
            pause: 0,
            yaw: 0,
        };
    }
    if (local < walk + SCOUT.pause) {
        // At the end of its pause it turns round (through a view of its face) to trot back.
        const pause = local - walk;
        const f = Math.min(1, Math.max(0, (pause - (SCOUT.pause - TURN - 0.1)) / TURN));
        return {
            x: SCOUT.to,
            facing: -1,
            travel: 0,
            walked: 0,
            pace: 0,
            moving: false,
            gaitKind: 'walk',
            pause,
            yaw: Math.PI * smooth(f),
            step: f * 2,
            stepHeight: 1.8 * Math.sin(f * Math.PI),
        };
    }
    if (local < walk + SCOUT.pause + trot) {
        const out = local - walk - SCOUT.pause;
        const d = glide(out, distance, SCOUT.trotSpeed, ramp);
        return {
            x: SCOUT.to + d,
            facing: 1,
            travel: d,
            walked: out * SCOUT.trotSpeed,
            pace: glidePace(out, distance, SCOUT.trotSpeed, ramp),
            moving: true,
            gaitKind: 'trot',
            pause: 0,
            yaw: 0,
        };
    }
    return null;
}

/**
 * What the scout does at its lookout, `pause` seconds after it stopped: looks out over the valley,
 * sniffs the snow, lifts a paw to listen, looks at you with a tilt of its head one way and the
 * other, glances back over its shoulder, and turns to go.
 */
export function scoutLookout(pause) {
    const p = pause;
    const scan = span(p, 0.2, 1.8, 0.5);
    const sniff = span(p, 1.6, 3.6, 0.45);
    const alert = span(p, 3.6, 6.1, 0.45);
    const look = span(p, 6, 9.5, 0.55);
    const back = span(p, 9.4, 10.9, 0.45);
    return {
        head: scan * (6 + Math.sin(p * 1.7) * 4) - sniff * 30 + alert * 10 + back * 30,
        ears: -alert * 10 - look * 8 + back * 6,
        pawUp: span(p, 4, 5.7, 0.35),
        turn: 0.85 * look,
        roll: 0.35 * span(p, 6.8, 7.9, 0.3) - 0.3 * span(p, 8.1, 9, 0.3),
        headYaw: 2.9 * back,
        neckYaw: 1.2 * back,
        tailUp: 0.25 * alert,
    };
}

/* ── The silhouette shader ─────────────────────────────────────────────────────────── */

function createWolfMaterial(noise, seed) {
    const rows = Array.from({ length: CAPSULE_COUNT * 2 }, () => new THREE.Vector4(0, 0, 0, 0));
    const capsules = uniformArray(rows, 'vec4');
    const uMoon = uniform(new THREE.Vector2(MOON_SCREEN.x, MOON_SCREEN.y));
    const uEye = uniform(new THREE.Vector3(0, 0, 0));
    const uEye2 = uniform(new THREE.Vector3(0, 0, 0));
    const uFade = uniform(1);
    // A shake: the fur's noise shivers (xy) and the coat fluffs out by z units.
    const uShake = uniform(new THREE.Vector3(0, 0, 0));
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
        const shiver = uShake.xy;
        const fur = texture(noise, p.mul(0.045).add(vec2(seed, seed * 1.7)).add(shiver)).r.mul(0.7)
            .add(texture(noise, p.mul(0.11).add(vec2(seed * 2.3, 0.4)).add(shiver.mul(2.3))).r.mul(0.3));
        const edge = d.sub(uShake.z).add(fur.sub(0.5).mul(uShake.z.mul(2.4).add(1.3))).toVar();
        const fw = max(fwidth(edge), 1e-3).toVar();
        const cover = float(1).sub(smoothstep(fw.negate(), fw, edge));
        // Moon rim: the outer band of the coat on the moon's side, about a pixel and a half wide.
        const facing = dot(g.normalize(), uMoon).toVar();
        const band = float(1).sub(smoothstep(0, fw.mul(1.7).max(0.6), edge.negate()));
        const rim = band.mul(smoothstep(0.38, 0.92, facing));
        const sheen = smoothstep(-5, 0, edge).mul(facing.max(0)).mul(0.25);
        const eyeA = p.sub(uEye.xy);
        const eyeB = p.sub(uEye2.xy);
        const glint = exp(dot(eyeA, eyeA).mul(-2.6)).mul(uEye.z)
            .add(exp(dot(eyeB, eyeB).mul(-2.6)).mul(uEye2.z));
        const colour = COAT.mul(sheen.add(1)).add(RIM.mul(rim)).add(GLINT.mul(glint));
        return vec4(colour, cover.mul(uFade));
    })();
    material.colorNode = shape.rgb;
    material.opacityNode = shape.a;
    return {
        material,
        rows,
        uniforms: {
            uMoon, uEye, uEye2, uFade, uShake,
        },
    };
}

/** Vapour and snow: soft round puffs, moonlit, fading as they rise and spread. */
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
            toward: 0,
            howling: 0,
            paws: [],
            visible: true,
            act: null,
        };
    };

    const group = new THREE.Group();
    group.name = 'Wolfhour pack';
    const wolves = PACK.map((spec, i) => makeWolf(spec, i));
    for (const wolf of wolves) group.add(wolf.mesh);
    const vapour = createVapour(lowTier ? 20 : 64);
    group.add(vapour.mesh);

    const answererGroup = new THREE.Group();
    answererGroup.name = 'Wolfhour answering wolf';
    const answerer = makeWolf(ANSWERER, 3);
    answererGroup.add(answerer.mesh);

    const scoutGroup = new THREE.Group();
    scoutGroup.name = 'Wolfhour scout';
    const scout = makeWolf({ ...SCOUT, facing: -1 }, 4);
    scout.spec = { ...scout.spec, role: 'scout' };
    scoutGroup.add(scout.mesh);

    const state = {
        howlStart: -Infinity,
        glanceStart: -Infinity,
        exciteStart: -Infinity,
        // The young wolf's own clock stands still through a howl it joins and while a combo
        // excites it: the stretches it stood still for, merged ([start, end] of the last one, and
        // the length of all those before it).
        stall: null,
        stalled: 0,
        youngJoins: true,
        excited: false,
        spread: 1,
        members: wolves.length,
    };
    const grounds = { pack: () => 0, answerer: () => 0, scout: () => 0 };
    const matrix = new THREE.Matrix4();
    const point = new THREE.Vector3();

    // The young wolf's own clock: real time less the stretches it stood still for (none before
    // the first howl or combo), so whatever it was doing waits and then carries on.
    const youngClock = (t) => {
        const last = state.stall;
        return t - state.stalled - (last ? Math.max(0, Math.min(t - last[0], last[1] - last[0])) : 0);
    };
    const standStill = (from, to) => {
        const last = state.stall;
        if (last && from <= last[1]) {
            last[1] = Math.max(last[1], to);
            return;
        }
        if (last) state.stalled += last[1] - last[0];
        state.stall = [from, to];
    };
    const joins = (spec) => spec.role !== 'young' || state.youngJoins;
    const howlOf = (spec, t) => (joins(spec) ? eventEnvelope(t - state.howlStart - spec.delay, HOWL) : 0);

    /**
     * Pose one wolf into its uniforms at `x`, facing ±1, on the ridge `groundAt` describes (the
     * ridge's height under any x of the wolf's group), from its behaviour `act` and the howl.
     */
    const pose = (entry, t, m, {
        x, groundAt, facing, act, howl = 0, glance = 0, fade = 1, visible = true,
        gaitKind = 'walk', stride = WALK_STRIDE, walked = 0, pace = 1, moving = false, yaw = 0, still = 0,
        clock = t,
    }) => {
        const { spec, mesh } = entry;
        mesh.visible = visible;
        entry.visible = visible;
        entry.act = act;
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
        const keep = 1 - howl;
        const a = act || {};
        const idle = !act || act.action === 'idle' || act.action === undefined;
        // Breathing, an ear flicked back now and then, a sniff at the wind when nothing else is on.
        const breath = Math.sin(t * 1.3 + spec.idlePhase) * m;
        const flick = Math.max(0, Math.sin(t * 0.9 + spec.idlePhase * 3)) ** 40 * 14 * m;
        // A sniff only begins in an idle slot that lasts until it is over (on the wolf's own clock).
        const sniffPhase = (clock + spec.idlePhase * 7) % 23;
        const book = REPERTOIRES[spec.role];
        const into = a.u ?? 0;
        const fits = !book || (into >= sniffPhase - 17 && book.slot - into >= 23 - sniffPhase);
        const sniff = idle && fits && sniffPhase > 17
            ? Math.sin(((sniffPhase - 17) / 6) * Math.PI) * 26 * m : 0;
        const restHead = spec.head + breath * 1.6 - sniff + (a.head ?? 0) + glance * 8;
        const wag = Math.max(a.wag ?? 0, 0);
        // The ears flick on their own, each now and then.
        const flickB = Math.max(0, Math.sin(t * 0.73 + spec.idlePhase * 5)) ** 40 * 12 * m;
        const sit = a.sit ?? 0;
        // A lying wolf sits up to howl.
        const down = (a.down ?? 0) * keep;
        const params = {
            gait: moving ? (walked / (stride * s)) : 0,
            stride: moving ? stride * pace * (1 - still) : 0,
            gaitKind,
            step: a.step ?? 0,
            stepHeight: (a.stepHeight ?? 0) * (1 - still),
            yaw,
            sit,
            down,
            foreDown: a.foreDown ? a.foreDown.map((d) => d * keep) : null,
            foreLift: a.foreLift ? a.foreLift.map((l) => l * keep) : null,
            head: restHead + (spec.howl - restHead) * howl,
            // Turning to look at you: its own looks, and every glance for a line clear.
            turn: Math.max(a.turn ?? 0, glance * (spec.role === 'lead' ? 0.9 : 0.7)) * keep,
            headYaw: (a.headYaw ?? 0) * keep * (1 - glance),
            neckYaw: (a.neckYaw ?? 0) * keep * (1 - glance),
            roll: (a.roll ?? 0) * keep,
            // The howl's note wavers: the jaw works a little while it holds.
            jaw: (a.jaw ?? 0) * keep + howl * (13 + Math.sin(t * 6.3 + spec.idlePhase) * 2.5),
            tail: moving
                ? Math.sin((walked / (stride * s)) * Math.PI * 2) * 6 * pace
                : Math.sin(t * 0.7 + spec.idlePhase) * 5 * m * (1 - wag)
                    + Math.sin(t * 11 + spec.idlePhase) * 22 * wag - howl * 8,
            tailUp: (a.tailUp ?? 0) * keep,
            breath,
            ears: (a.ears ?? 0) * keep + howl * 14 + flick - glance * 6,
            earA: (a.earA ?? 0) * keep,
            earB: (a.earB ?? 0) * keep + flickB,
            crouch: (a.crouch ?? 0) * keep,
            lift: (a.lift ?? 0) * keep,
            pitch: (a.pitch ?? 0) * keep,
            tuck: (a.tuck ?? 0) * keep,
            reach: (a.reach ?? 0) * keep,
            hindReach: (a.hindReach ?? 0) * keep,
            pawUp: (a.pawUp ?? 0) * keep,
            scratch: (a.scratch ?? 0) * keep,
            scratchPhase: a.scratchPhase ?? 0,
            dig: (a.dig ?? 0) * keep,
            digPhase: a.digPhase ?? 0,
            ground: ridge,
        };
        const rig = poseWolf(params, entry.capsules);
        const c = rig.capsules;
        for (let i = 0; i < CAPSULE_COUNT; i++) {
            const o = i * CAPSULE_STRIDE;
            entry.rows[i * 2].set(c[o], c[o + 1], c[o + 2], c[o + 3]);
            entry.rows[i * 2 + 1].set(c[o + 4], c[o + 5], c[o + 6], 0);
        }
        mesh.scale.set(facing * s, s, 1);
        mesh.position.set(x, base - spec.sink * s, 0.01 * s);
        // The moon is upper left on screen; a mirrored wolf sees it from its other side.
        entry.uniforms.uMoon.value.set(MOON_SCREEN.x * facing, MOON_SCREEN.y);
        const open = 0.3 * (1 - (a.eyesClosed ?? 0) * keep) * (1 - howl * 0.7)
            * (1 - blinkAt(t, spec.idlePhase) * (1 - howl));
        entry.uniforms.uEye.value.set(rig.eye[0], rig.eye[1], open * rig.eye[2]);
        entry.uniforms.uEye2.value.set(rig.eye2[0], rig.eye2[1], open * rig.eye2[2]);
        entry.uniforms.uFade.value = fade;
        const shake = (a.shake ?? 0) * keep;
        entry.uniforms.uShake.value.set(
            Math.sin(t * 41) * 0.06 * shake,
            Math.cos(t * 37) * 0.06 * shake,
            0.9 * shake,
        );
        [entry.muzzle[0], entry.muzzle[1]] = rig.muzzle;
        entry.toward = rig.toward;
        entry.howling = howl;
        entry.paws = rig.paws;
        entry.ridge = ridge;
        entry.facing = facing;
    };

    /** Rig point (x, y) of a wolf into the pack group's frame. */
    const toGroup = (entry, x, y) => {
        entry.mesh.updateWorldMatrix(true, false);
        point.set(x, y, 0.3).applyMatrix4(entry.mesh.matrixWorld);
        return group.worldToLocal(point);
    };

    // The answerer and the scout stand in groups of their own, at their own sizes.
    const groupScale = (entry) => (wolves.includes(entry) ? 1
        : (entry.mesh.parent?.scale.x || 1) / (group.scale.x || 1));
    const placeVapour = (t, breathing) => {
        let count = 0;
        const emit = (x, y, z, size, alpha) => {
            if (count >= vapour.alpha.length) return;
            matrix.makeScale(size, size, 1);
            matrix.setPosition(x, y, z);
            vapour.mesh.setMatrixAt(count, matrix);
            vapour.alpha[count] = alpha;
            count += 1;
        };
        for (const entry of [...wolves, answerer, scout]) {
            if (!entry.visible) continue;
            const size0 = entry.spec.scale;
            // A breath in the cold: a little smoke leaves the muzzle as each breath goes out.
            if (breathing > 0 && entry.howling < 0.05 && entry.uniforms.uFade.value > 0.5) {
                const phase = t * BREATH_RATE + entry.spec.idlePhase - Math.PI / 2;
                const turn = Math.PI * 2;
                const life = (((phase % turn) + turn) % turn) / BREATH_RATE;
                if (life < BREATH.life) {
                    const f = life / BREATH.life;
                    const m = toGroup(entry, entry.muzzle[0], entry.muzzle[1]);
                    const ahead = (1 - Math.abs(entry.toward) * 0.7) * entry.facing;
                    emit(
                        m.x + (1 + f * 5) * ahead * size0 * groupScale(entry),
                        m.y + (f * 3.5 - 0.6) * size0 * groupScale(entry),
                        m.z + 0.2,
                        (1.6 + f * 4.5) * size0 * groupScale(entry),
                        BREATH.alpha * breathing * Math.sin(Math.min(1, f * 5) * Math.PI * 0.5) * (1 - f) ** 1.6,
                    );
                }
            }
            if (!wolves.includes(entry)) continue;
            // Breath: a puff leaves the muzzle every 0.4 s while the note is held.
            const age = joins(entry.spec) ? t - state.howlStart - entry.spec.delay : -1;
            if (age >= HOWL.rise * 0.6 && age <= HOWL_SPAN + 2.2) {
                const m = toGroup(entry, entry.muzzle[0], entry.muzzle[1]);
                const mx = m.x;
                const my = m.y;
                const mz = m.z;
                for (let k = 0; k < 10; k++) {
                    const born = HOWL.rise * 0.6 + k * 0.4;
                    if (born > HOWL.rise + HOWL.hold) break;
                    const life = age - born;
                    if (life >= 0 && life <= 2.2) {
                        const f = life / 2.2;
                        emit(
                            mx + (2 + f * 9) * entry.facing * size0,
                            my + (1 + f * 13) * size0,
                            mz + 0.2,
                            (2.6 + f * 10) * size0,
                            0.6 * Math.sin(Math.min(1, f * 4) * Math.PI * 0.5) * (1 - f) ** 1.5,
                        );
                    }
                }
            }
            // Snow: thrown off the coat in a ring when it shakes, flung up in a plume where a
            // pounce lands.
            for (const burst of entry.act?.bursts ?? []) {
                const life = (entry.act.u ?? 0) - burst.at;
                if (life < 0 || life > PUFF_LIFE) continue;
                const f = life / PUFF_LIFE;
                const o = toGroup(entry, burst.x, burst.y);
                const ox = o.x;
                const oy = o.y;
                const oz = o.z;
                for (let j = 0; j < burst.count; j++) {
                    const spin = j * 2.399 + burst.at * 3.1;
                    let angle = Math.PI * 0.5 + Math.sin(spin) * 0.9 - entry.facing * 0.35;
                    if (burst.kind === 'ring') angle = spin;
                    // Digging throws the snow back between the legs, low.
                    if (burst.kind === 'spray') {
                        angle = (entry.facing > 0 ? Math.PI - 0.55 : 0.55) + Math.sin(spin) * 0.3;
                    }
                    const speed = (burst.kind === 'ring' ? 10 : 15) * (0.55 + ((j * 0.618) % 1) * 0.6)
                        * (burst.kind === 'spray' ? 0.8 : 1);
                    const travelled = speed * (1 - (1 - f) ** 2) * size0;
                    emit(
                        ox + Math.cos(angle) * travelled,
                        oy + Math.sin(angle) * travelled - f * f * 6 * size0,
                        oz + 0.25,
                        (2.2 + f * 5.5) * size0,
                        0.85 * (1 - f) ** 1.3 * Math.min(1, life * 10),
                    );
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
        /**
         * A four-line clear: the pack howls. Ignored while a howl is still sounding. The young
         * wolf joins unless it is in mid-pounce, in which case it stays on the hunt.
         */
        howl(time) {
            if (!Number.isFinite(time)) return false;
            if (time - state.howlStart < (HOWL_SPAN + 1.05) * 0.8) return false;
            state.howlStart = time;
            state.youngJoins = !busyAt('young', youngClock(time));
            if (state.youngJoins) standStill(time, time + HOWL_STILL);
            return true;
        },
        /** A smaller clear: the pack turns to look at you. */
        glance(time) {
            if (Number.isFinite(time)) state.glanceStart = time;
        },
        /**
         * A combo: the young wolf gets excited (unless it is busy hunting): whatever it was doing
         * waits while it bows and wags.
         */
        excite(time) {
            if (!Number.isFinite(time)) return;
            state.exciteStart = time;
            state.excited = !busyAt('young', youngClock(time));
            if (state.excited) standStill(time, time + EXCITE_SPAN);
        },
        /** How strongly the pack is howling now (0..1): drives the mist and the moon's answer. */
        howlLevel(time) {
            let level = 0;
            for (const entry of wolves) level = Math.max(level, howlOf(entry.spec, time));
            return level;
        },
        /** Where the scout is now (null between its visits). */
        scoutAt,
        /**
         * Pose every wolf at `time`. `motion` (0..1) scales idle movement; below 0.5 the wolves stay
         * where they are (no pacing, no pouncing, no scout) and only turn, yawn, sit and howl.
         */
        update(time, motion = 1) {
            const t = Number.isFinite(time) ? time : 0;
            const m = Number.isFinite(motion) ? Math.min(1, Math.max(0, motion)) : 1;
            const walking = m >= 0.5;
            const glance = eventEnvelope(t - state.glanceStart, GLANCE);
            const excite = eventEnvelope(t - state.exciteStart, EXCITE);
            // A wolf facing away from the moon when a howl begins turns round to it as its head
            // comes up, and back again as the note ends.
            const howlYaw = (yaw, facing, home, howl) => (howl > 0 && facing !== home
                ? yaw + (Math.PI - yaw) * howl
                : yaw * (1 - howl));
            wolves.forEach((entry, i) => {
                const { spec } = entry;
                const howl = howlOf(spec, t);
                const moves = spec.role === 'young';
                const clock = moves ? youngClock(t) : t;
                let act = behaviourAt(spec.role, clock, { still: !walking });
                // Excitement (a combo) puts the young wolf into a bow with a wagging tail.
                const excited = moves && walking && state.excited ? excite : 0;
                if (excited > 0) {
                    act = { ...act, reach: act.reach + 6 * excited, pitch: act.pitch - 0.28 * excited };
                    act.tailUp = Math.max(act.tailUp, excited);
                    act.wag = Math.max(act.wag, excited);
                    act.lift += Math.abs(Math.sin(t * 7)) * 2.5 * excited;
                }
                const x = (spec.x + (moves ? act.dx : 0)) * state.spread;
                const facing = act.facing ?? spec.facing;
                const turning = act.busy ? 0 : howl;
                pose(entry, t, m, {
                    x,
                    groundAt: grounds.pack,
                    facing,
                    yaw: howlYaw(act.yaw ?? 0, facing, spec.facing, turning),
                    clock,
                    act,
                    howl,
                    glance,
                    // A walk it stands still for (a howl, a combo) settles its paws.
                    moving: act.moving,
                    still: Math.max(howl, excited),
                    walked: act.walked * state.spread,
                    pace: act.pace,
                    visible: i < state.members,
                });
            });
            const far = behaviourAt(ANSWERER.role, t, { still: !walking });
            pose(answerer, t, m, {
                x: 0,
                groundAt: grounds.answerer,
                facing: ANSWERER.facing,
                act: far,
                howl: howlOf(ANSWERER, t),
                glance: glance * 0.6,
            });
            const walk = walking ? scoutAt(t) : null;
            if (walk) {
                // It fades in and out at the frame's edge rather than popping. At its lookout it
                // looks round and at you, and howls with the pack if it stands there.
                const howl = walk.moving ? 0 : eventEnvelope(t - state.howlStart - SCOUT.delay, HOWL);
                pose(scout, t, m, {
                    x: walk.x,
                    groundAt: grounds.scout,
                    facing: walk.facing,
                    yaw: howlYaw(walk.yaw ?? 0, walk.facing, -1, howl),
                    act: {
                        ...(walk.moving ? {} : scoutLookout(walk.pause)),
                        step: walk.step ?? 0,
                        stepHeight: walk.stepHeight ?? 0,
                    },
                    howl,
                    glance,
                    moving: walk.moving,
                    walked: walk.walked,
                    pace: walk.pace,
                    gaitKind: walk.gaitKind,
                    stride: walk.gaitKind === 'trot' ? TROT_STRIDE : WALK_STRIDE,
                    fade: smooth((SCOUT.from - walk.x) / 30),
                });
            } else {
                pose(scout, t, m, {
                    x: SCOUT.from, groundAt: grounds.scout, facing: -1, visible: false,
                });
            }
            placeVapour(t, m);
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

/** The young wolf's moves, for placement checks (pack units). */
export { YOUNG_MOVES };
