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
 * sandy brown above against blackish flight feathers, lit by the act's sun and sky. They soar,
 * with a slow beat or two now and then (`summitWingPose` is the vertex stage's pose).
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
    birdColourNode, birdWingPoseAt, decodeBirdModel, foldBirdNode, setBirdTemplate,
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
    /** Roll into the turn, radians. */
    bank: 0.32,
    /**
     * [fade in from, fully in by, fade out from, gone by] in JOURNEY progress. The fade out
     * waits until the climb has carried the whole kettle out of frame (p 0.673 on the real
     * camera; it began at 0.665 with a quarter of it still in view) — see
     * odyssey-act2-fade-out-of-view.test.js.
     */
    window: Object.freeze([0.36, 0.40, 0.674, 0.704]),
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

const jsSmooth = (e0, e1, x) => {
    const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return k * k * (3 - (2 * k));
};

/**
 * The vertex stage's wing pose at clock `t` for a bird of `seed` (the CPU twin, for the tests):
 * soaring on held wings, fingers curled up, with a few slow beats now and then on its own clock.
 */
export function summitWingPose(t, seed, out = {}) {
    const model = decodeBirdModel('vulture');
    const beating = jsSmooth(0.55, 0.9, Math.sin((t * 0.21) + (seed * 11)));
    const cycles = (model.flight.rate * (1 + ((seed - 0.5) * 0.06)) * t) + (seed * 7);
    return birdWingPoseAt(model, (cycles - Math.floor(cycles)) * TAU, beating, out);
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

    // Round the thermal, counter-clockwise; each bird a little faster or slower than its lap.
    const angle = uTime.mul(TAU / config.lapSeconds).mul(seed.mul(0.3).add(0.85)).add(aLane.x.mul(TAU));
    const c = cos(angle);
    const s = sin(angle);
    const radial = vec3(c, 0, s);
    const forward = vec3(s.negate(), 0, c);
    // Right wing = forward x up = -radial (toward the centre); banking dips it into the turn.
    const cosB = Math.cos(config.bank);
    const sinB = Math.sin(config.bank);
    const left = radial.mul(cosB).add(vec3(0, sinB, 0));
    const up = vec3(0, cosB, 0).sub(radial.mul(sinB));
    const bob = sin(uTime.mul(0.23).add(seed.mul(9.0))).mul(3.0);
    const centre = vec3(...config.centre);
    const seat = centre.add(radial.mul(aLane.y)).add(vec3(0, 1, 0).mul(aLane.z.add(bob)));

    const vBirdN = varying(vec3(0, 1, 0), 'summitBirdN');
    const vSpeck = varying(vec3(0, 0, 0), 'summitBirdSpeck');
    const { glide, beat } = model.flight;
    const positionNode = Fn(() => {
        // SOARING (the twin: summitWingPose): wings held in a shallow dihedral, the fingers
        // curled up, a slow beat or two now and then (each bird on its own clock); the hand lags.
        const beating = smoothstep(0.55, 0.9, sin(uTime.mul(0.21).add(seed.mul(11.0))));
        const rate = seed.sub(0.5).mul(0.06).add(1.0).mul(model.flight.rate);
        const phi = fract(rate.mul(uTime).add(seed.mul(7.0))).mul(TAU).toVar();
        const sinPhi = sin(phi);
        const upK = max(sinPhi.negate(), 0.0).mul(max(sinPhi.negate(), 0.0));
        const beatLift = cos(phi).mul(beat.lift[1]).add(beat.lift[0]);
        const beatHand = cos(phi.sub(beat.lag)).mul(beat.hand[1]).add(beat.hand[0]);
        const pose = (name, value) => mix(float(glide[name]), value, beating);
        const { local, normal } = foldBirdNode({
            position: positionLocal,
            normal: attribute('normal', 'vec3'),
            hinge: attribute('aHinge', 'vec4'),
            pose: {
                lift: pose('lift', beatLift),
                sweep: pose('sweep', upK.mul(beat.sweep[1]).add(beat.sweep[0])),
                bend: pose('bend', beatHand.sub(beatLift)),
                fold: pose('fold', upK.mul(beat.fold[1]).add(beat.fold[0])),
                curl: pose('curl', max(sinPhi, 0.0).mul(beat.curl)),
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
        return seat.add(left.mul(local.x).add(up.mul(local.y)).add(forward.mul(local.z)).mul(size));
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
