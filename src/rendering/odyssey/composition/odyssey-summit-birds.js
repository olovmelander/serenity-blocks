/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SUMMIT BIRDS — a kettle of soaring birds riding the thermal beside the mountain (chapter 5).
 *
 * The climb had a mountain, clouds and nothing ALIVE: no moving thing to give the peak its
 * scale, and nothing to look at but the rail. A dozen birds now circle beside the summit's east
 * shoulder for the whole climb — against the sky and the cloud from the wall, the subject of the
 * look-out's pan, wheeling beside the summit in its shot, and BELOW the eye from the shoulder,
 * seen from above against the island.
 *
 * THE BIRDS (2026-11): griffon vultures, the Blender birds' fourth (odyssey_birds.py ->
 * odyssey-bird-models.js, folded by odyssey-bird-rig.js) — they are 18-80 px across on the climb,
 * so the flat paper shape they were read as a cut-out. Long broad wings held in a shallow
 * dihedral with six splayed primaries curled up at the tip, a short square tail, a pale ruff;
 * sandy brown above against blackish flight feathers, lit by the act's sun and sky.
 *
 * HOW THEY SOAR (2026-11-03): griffons ride a thermal on held wings and almost never beat. Each
 * bird now beats once a minute or so (two or three slow strokes keyframed in Blender,
 * odyssey-bird-beats.js, starting and ending at mid-upstroke), and between those it is alive on
 * the air: it tilts in and out of its bank and pitches a little (each bird on its own slow
 * clock), its wings flex and its fingers bend with the gusts, its tail twists against each tilt,
 * and its body rises against a beat. They beat a quarter of the time before. `summitWingPose` and
 * `summitFrameAt` are the vertex stage's CPU twins.
 *
 * WHERE: the kettle's centre and lanes were solved on the in-game camera (BEYOND profile, drift
 * pinned) so it is in frame at every station from L29 to L34, clears the hero cone (>= 30 u) and
 * never comes within ~85 u of the eye; the rail only crosses above it (>= 120 u) after the flock
 * has gone. `odyssey-summit-birds.test.js` holds the terrain and rail clearances.
 *
 * WHY A COMPOSITION ELEMENT (the whale pass's reasoning, ADR-0017): a one-off staged moment on
 * the rail, not world content — the world renderer stays untouched.
 *
 * ZERO-HITCH (ADR-0020): one instanced draw, opaque, built at board construction and compiled
 * with the board's own presentation group before the reveal. Everything after that is uniforms:
 * the flock is revealed by SCALE (`uReveal` 0..1 — a bird that small shrinking to nothing reads
 * as flying off), so no blend state, no alpha and no pipeline ever changes.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, cameraPosition, cos, float, fract, length, max, mix, positionLocal, sin, smoothstep, uniform,
    varying, vec3,
} from 'three/tsl';
import {
    beatHarmonicsNode, beatSeriesConstants, beatSeriesNode, birdBoutAt, birdBoutNode, birdColourNode,
    birdWingPoseAt, decodeBirdModel, foldBirdNode, setBirdTemplate, tailBirdNode,
} from './odyssey-bird-rig.js';

/** The kettle: centre of the thermal, lane radii and heights, and one lap's period. */
export const SUMMIT_BIRDS = Object.freeze({
    count: 12,
    centre: Object.freeze([0, 940, -1055]),
    radius: Object.freeze([55, 95]),
    heightSpread: 22,
    lapSeconds: 44,
    /** A bird's wingspan, world units (the old 3.8-unit template at 3.0 u per unit). */
    span: 11.4,
    /** Roll into the turn, radians (each bird tilts in and out of it: SUMMIT_SOAR.tilt). */
    bank: 0.32,
    /**
     * [fade in from, fully in by, fade out from, gone by] in JOURNEY progress. The fade out
     * waits until the climb has carried the whole kettle out of frame (p 0.678 on the real
     * camera; it began at 0.665 with a quarter of it still in view) — see
     * odyssey-act2-fade-out-of-view.test.js. (0.674 until 2026-11-02: L33's view now looks down
     * past the horn, over the kettle, and lets it go ~0.005 later.)
     */
    window: Object.freeze([0.36, 0.40, 0.679, 0.709]),
});

/**
 * The soaring: each bird's beats (odyssey-bird-rig.js `birdBoutAt`: one bout of 2-3 beats every
 * 55-95 s), its tilts in the thermal ([amplitude rad, rate rad/s] x3: slow, smaller, quicker),
 * pitch, the held wing's flex and the fingers' bend ([amplitude, rate]), and the tail.
 */
export const SUMMIT_SOAR = Object.freeze({
    bouts: Object.freeze({
        period: Object.freeze([55, 95]), beats: Object.freeze([2, 3]), start: 0.70, rise: 0.30, fall: 0.42, tail: 0.12,
    }),
    tilt: Object.freeze([[0.045, 0.83], [0.025, 1.9], [0.012, 3.1]]),
    pitch: Object.freeze([0.02, 0.61]),
    flex: Object.freeze([0.025, 1.1]),
    fingers: Object.freeze([[0.05, 1.7], [0.03, 2.9]]),
    /** The tail: [spread at rest, spread slow swing, twist per radian of bank, twist per radian of tilt]. */
    tail: Object.freeze([0.16, 0.06, 0.25, -1.6]),
});

const TAU = Math.PI * 2;

/** Deterministic per-bird lanes (no Math.random: the flock is the same every session). */
export function resolveSummitBirdLanes(config = SUMMIT_BIRDS) {
    const lanes = [];
    let state = 0x9e3779b9;
    const rnd = () => {
        state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < config.count; i += 1) {
        lanes.push({
            // Spread round the whole thermal, jittered, so some birds are always in frame.
            phase: (i + (rnd() * 0.7)) / config.count,
            radius: config.radius[0] + (rnd() * (config.radius[1] - config.radius[0])),
            height: (rnd() - 0.5) * 2 * config.heightSpread,
            seed: rnd(),
        });
    }
    return lanes;
}

/** A bird's tilt in and out of its bank (radians) at clock `t`. */
export function summitTilt(t, seed) {
    const [[a0, r0], [a1, r1], [a2, r2]] = SUMMIT_SOAR.tilt;
    return (a0 * Math.sin((r0 * t) + (seed * 9))) + (a1 * Math.sin((r1 * t) + (seed * 4)))
        + (a2 * Math.sin((r2 * t) + (seed * 2)));
}

const boutScratch = { weight: 0, phase: 0 };

/** How much of a beat a bird of `seed` is in at clock `t` (0 soaring .. 1 beating). */
export function summitBeatWeight(t, seed) {
    const model = decodeBirdModel('vulture');
    return birdBoutAt(t, seed, { ...SUMMIT_SOAR.bouts, rate: model.flight.rate }, boutScratch).weight;
}

/**
 * The vertex stage's wing pose at clock `t` for a bird of `seed` (the CPU twin, for the tests):
 * soaring on held wings that flex on the air, fingers bending, a bout of slow beats now and
 * then, the body's heave against a beat and the tail's spread and twist.
 */
export function summitWingPose(t, seed, out = {}, config = SUMMIT_BIRDS) {
    const model = decodeBirdModel('vulture');
    const { weight, phase } = birdBoutAt(t, seed, { ...SUMMIT_SOAR.bouts, rate: model.flight.rate }, boutScratch);
    const [fa, fr] = SUMMIT_SOAR.flex;
    const [[ca, cr], [cb, cr2]] = SUMMIT_SOAR.fingers;
    const flex = {
        lift: fa * Math.sin((fr * t) + (seed * 5)),
        curl: (ca * Math.sin((cr * t) + (seed * 7))) + (cb * Math.sin((cr2 * t) + (seed * 2))),
    };
    birdWingPoseAt(model, phase * TAU, weight, out, flex);
    const [s0, s1, tb, tt] = SUMMIT_SOAR.tail;
    out.tailSpread = s0 + (s1 * Math.sin((0.5 * t) + (seed * 3)));
    out.tailTwist = (tb * config.bank) + (tt * summitTilt(t, seed));
    out.weight = weight;
    return out;
}

/** The bird of `lane`'s angle round the thermal at clock `t`. */
function laneAngle(lane, t, config) {
    return ((t * TAU) / config.lapSeconds) * ((lane.seed * 0.3) + 0.85) + (lane.phase * TAU);
}

/** Where the bird of `lane` is at clock `t` (world): its lane round the thermal, bobbing slowly. */
export function summitBirdPositionAt(lane, t, config = SUMMIT_BIRDS) {
    const a = laneAngle(lane, t, config);
    const bob = Math.sin((t * 0.23) + (lane.seed * 9)) * 3;
    return {
        x: config.centre[0] + (Math.cos(a) * lane.radius),
        y: config.centre[1] + lane.height + bob,
        z: config.centre[2] + (Math.sin(a) * lane.radius),
    };
}

/**
 * CPU twin of the vertex stage's body frame for bird `index` at clock `t`: its place, its bank
 * with the tilts, and its pitch.
 * @returns {{position:number[], left:number[], up:number[], forward:number[], roll:number, pitch:number}}
 */
export function summitFrameAt(index, t, config = SUMMIT_BIRDS) {
    const lane = resolveSummitBirdLanes(config)[index];
    const a = laneAngle(lane, t, config);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const roll = config.bank + summitTilt(t, lane.seed);
    const pitch = SUMMIT_SOAR.pitch[0] * Math.sin((SUMMIT_SOAR.pitch[1] * t) + (lane.seed * 3));
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const left = [c * cr, sr, s * cr];
    const up0 = [-c * sr, cr, -s * sr];
    const fwd0 = [-s, 0, c];
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const p = summitBirdPositionAt(lane, t, config);
    return {
        position: [p.x, p.y, p.z],
        left,
        up: [0, 1, 2].map((k) => (up0[k] * cp) - (fwd0[k] * sp)),
        forward: [0, 1, 2].map((k) => (fwd0[k] * cp) + (up0[k] * sp)),
        roll,
        pitch,
    };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL node (vec3) the far birds haze toward — the world's own
 *   horizon colour when it built one; a daylight constant otherwise.
 * @param {object} [opts.sunColour] TSL vec3 node, the world's sun colour (else a daylight white)
 * @param {number[]} [opts.sunDir] direction TOWARD the sun (world); defaults to the Act II sun
 * @param {object} [opts.config] override of SUMMIT_BIRDS (tests, the playground)
 */
export function createSummitBirds({
    hazeColour = null, sunColour = null, sunDir = [-0.46, 0.36, 0.61], config = SUMMIT_BIRDS,
} = {}) {
    const lanes = resolveSummitBirdLanes(config);
    const model = decodeBirdModel('vulture');
    const geometry = setBirdTemplate(new THREE.InstancedBufferGeometry(), model, THREE.BufferAttribute);
    const lane = new Float32Array(lanes.length * 4);
    lanes.forEach((l, i) => lane.set([l.phase, l.radius, l.height, l.seed], i * 4));
    geometry.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    geometry.instanceCount = lanes.length;

    const uTime = uniform(0);
    const uReveal = uniform(0);
    const aLane = attribute('aLane', 'vec4');
    const seed = aLane.w;
    const { glide } = model.flight;
    const sinAt = (amp, rate, offset) => sin(uTime.mul(rate).add(seed.mul(offset))).mul(amp);

    const vBirdN = varying(vec3(0, 1, 0), 'summitBirdN');
    const vSpeck = varying(vec3(0, 0, 0), 'summitBirdSpeck');
    const positionNode = Fn(() => {
        // Round the thermal, counter-clockwise; each bird a little faster or slower than its lap.
        const angle = uTime.mul(TAU / config.lapSeconds).mul(seed.mul(0.3).add(0.85)).add(aLane.x.mul(TAU)).toVar();
        const c = cos(angle);
        const s = sin(angle);
        const radial = vec3(c, 0, s).toVar();
        const forward0 = vec3(s.negate(), 0, c);
        // The bank (right wing = -radial, toward the centre, dipped into the turn), tilting in and
        // out of it on the bird's own slow clock (the twin: summitTilt), and a little pitch.
        const [[a0, r0], [a1, r1], [a2, r2]] = SUMMIT_SOAR.tilt;
        const tilt = sinAt(a0, r0, 9.0).add(sinAt(a1, r1, 4.0)).add(sinAt(a2, r2, 2.0)).toVar();
        const roll = tilt.add(config.bank);
        const cr = cos(roll);
        const sr = sin(roll);
        const left = radial.mul(cr).add(vec3(0, 1, 0).mul(sr)).toVar();
        const up0 = vec3(0, 1, 0).mul(cr).sub(radial.mul(sr));
        const pitch = sinAt(SUMMIT_SOAR.pitch[0], SUMMIT_SOAR.pitch[1], 3.0);
        const cp = cos(pitch);
        const sp = sin(pitch);
        const up = up0.mul(cp).sub(forward0.mul(sp)).toVar();
        const forward = forward0.mul(cp).add(up0.mul(sp)).toVar();
        const bob = sin(uTime.mul(0.23).add(seed.mul(9.0))).mul(3.0);
        const seat = vec3(...config.centre).add(radial.mul(aLane.y)).add(vec3(0, 1, 0).mul(aLane.z.add(bob))).toVar();

        // SOARING (the twin: summitWingPose): wings held in a shallow dihedral that flexes on the
        // air, the fingers curled up and bending with the gusts; a bout of slow beats now and
        // then (each bird on its own clock), starting and ending at mid-upstroke.
        const bout = birdBoutNode(uTime, seed, { ...SUMMIT_SOAR.bouts, rate: model.flight.rate });
        const beating = bout.weight.toVar();
        const phi = fract(bout.phase).mul(TAU).toVar();
        const h = beatHarmonicsNode(phi);
        const series = beatSeriesConstants(model);
        const [[ca, cr1], [cb, cr2]] = SUMMIT_SOAR.fingers;
        const held = {
            lift: float(glide.lift).add(sinAt(SUMMIT_SOAR.flex[0], SUMMIT_SOAR.flex[1], 5.0)),
            sweep: float(glide.sweep),
            bend: float(glide.bend),
            fold: float(glide.fold),
            curl: float(glide.curl).add(sinAt(ca, cr1, 7.0)).add(sinAt(cb, cr2, 2.0)),
        };
        const pose = (name) => mix(held[name], beatSeriesNode(series[name], h), beating).toVar();
        const heave = beatSeriesNode(series.heave, h).mul(beating);
        // The tail spreads and twists against each tilt (the twin's tailSpread / tailTwist).
        const [s0, s1, tb, tt] = SUMMIT_SOAR.tail;
        const tailed = tailBirdNode({
            position: positionLocal,
            normal: attribute('normal', 'vec3'),
            tail: attribute('aTop', 'vec4').w,
            spread: sinAt(s1, 0.5, 3.0).add(s0),
            twist: tilt.mul(tt).add(tb * config.bank),
            tailY: float(model.tailY),
        });
        const { local, normal } = foldBirdNode({
            position: tailed.position,
            normal: tailed.normal,
            hinge: attribute('aHinge', 'vec4'),
            pose: {
                lift: pose('lift'),
                sweep: pose('sweep'),
                bend: pose('bend'),
                fold: pose('fold'),
                curl: pose('curl'),
            },
            shoulder: model.shoulder,
            wrist: model.wrist,
        });
        vBirdN.assign(left.mul(normal.x).add(up.mul(normal.y)).add(forward.mul(normal.z)));
        // Under ~14 px across a bird darkens a little toward its silhouette and loses its rim
        // (the flights' rule: a far bird reads only while it is darker than the air behind it).
        const across = float(config.span).div(max(length(seat.sub(cameraPosition)), 1.0));
        const far = float(1).sub(smoothstep(0.0048, 0.0112, across));
        vSpeck.assign(vec3(far, far.mul(0.35), 0));
        const size = float(config.span / model.span).mul(uReveal);
        return seat.add(left.mul(local.x).add(up.mul(local.y.add(heave))).add(forward.mul(local.z)).mul(size));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseySummitBirds';
    material.positionNode = positionNode;
    // The act's light (the flights' and the eagle's); the island's rock and green bounced up
    // under the wings; the far side of the kettle sits back in the air as before.
    material.colorNode = birdColourNode({
        normal: vBirdN,
        speck: vSpeck,
        bounce: vec3(0.21, 0.22, 0.19),
        sunColour: sunColour ?? vec3(1.0, 0.96, 0.88),
        sunDir: new THREE.Vector3(...sunDir).normalize().toArray(),
        haze: hazeColour ?? vec3(0.71, 0.81, 0.91),
        hazeRange: [250, 1500, 0.55],
    });
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
    // It carries its own colour-with-distance; scene fog is the chapter-profile lerp.
    material.fog = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-summit-birds';
    // Positions are computed in the vertex stage from the lanes; the template's bounds are
    // meaningless for culling.
    mesh.frustumCulled = false;
    mesh.visible = false;

    return {
        mesh,
        uniforms: { uTime, uReveal },
        /**
         * @param {number} time seconds
         * @param {number} progress journey progress 0..1
         */
        update(time, progress) {
            const [inFrom, inTo, outFrom, outTo] = config.window;
            const reveal = THREE.MathUtils.smoothstep(progress, inFrom, inTo)
                * (1 - THREE.MathUtils.smoothstep(progress, outFrom, outTo));
            uReveal.value = reveal;
            uTime.value = time;
            mesh.visible = reveal > 0.01;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
