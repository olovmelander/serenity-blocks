/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SUMMIT BIRDS — a kettle of soaring birds riding the thermal beside the mountain (chapter 5).
 *
 * The climb had a mountain, clouds and nothing ALIVE: no moving thing to give the peak its
 * scale, and nothing to look at but the rail. A dozen birds now circle beside the summit's east
 * shoulder for the whole climb — small dark silhouettes against the sky and the cloud from the
 * wall, the subject of the look-out's pan, wheeling beside the summit in its shot, and BELOW the
 * eye from the shoulder, seen from above against the island.
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
    attribute, cameraPosition, cos, float, length, mix, positionLocal, sin, smoothstep, uniform, vec3,
} from 'three/tsl';

/** The kettle: centre of the thermal, lane radii and heights, and one lap's period. */
export const SUMMIT_BIRDS = Object.freeze({
    count: 12,
    centre: Object.freeze([0, 940, -1055]),
    radius: Object.freeze([55, 95]),
    heightSpread: 22,
    lapSeconds: 44,
    /** World units per template unit: a 3.8-unit wingspan becomes ~11 u. */
    size: 3.0,
    /** Roll into the turn, radians. */
    bank: 0.32,
    /** [fade in from, fully in by, fade out from, gone by] in JOURNEY progress. */
    window: Object.freeze([0.36, 0.40, 0.665, 0.695]),
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

/**
 * One bird, in its own space: -Z is the nose, +X the right wing, +Y up. `aWing` is 0 on the
 * body and at the wing roots, ~0.45 at the wrist and 1 at the tips — the flap bends there.
 */
function buildBirdTemplate() {
    const positions = [];
    const wing = [];
    const tri = (a, b, c) => {
        [a, b, c].forEach(([x, y, z, w]) => {
            positions.push(x, y, z);
            wing.push(w);
        });
    };
    // Body: a slim diamond with a short tail fan.
    const nose = [0, 0, -0.95, 0];
    const tail = [0, 0, 0.85, 0];
    const bl = [-0.13, 0, -0.1, 0];
    const br = [0.13, 0, -0.1, 0];
    tri(nose, br, bl);
    tri(bl, br, tail);
    tri(tail, [0.22, 0, 1.15, 0], [-0.22, 0, 1.15, 0]);
    // Wings: an inner panel (shoulder -> wrist) and a swept outer panel (wrist -> tip).
    [-1, 1].forEach((side) => {
        const rootF = [0.1 * side, 0, -0.42, 0];
        const rootB = [0.1 * side, 0, 0.28, 0];
        const wristF = [0.92 * side, 0, -0.5, 0.45];
        const wristB = [0.88 * side, 0, 0.12, 0.45];
        const tip = [1.9 * side, 0, 0.18, 1];
        tri(rootF, wristF, rootB);
        tri(rootB, wristF, wristB);
        tri(wristF, tip, wristB);
    });
    return { positions: new Float32Array(positions), wing: new Float32Array(wing) };
}

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL node (vec3) the far birds haze toward — the world's own
 *   horizon colour when it built one; a daylight constant otherwise.
 * @param {object} [opts.config] override of SUMMIT_BIRDS (tests, the playground)
 */
export function createSummitBirds({ hazeColour = null, config = SUMMIT_BIRDS } = {}) {
    const lanes = resolveSummitBirdLanes(config);
    const template = buildBirdTemplate();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(template.positions, 3));
    geometry.setAttribute('aWing', new THREE.BufferAttribute(template.wing, 1));
    const lane = new Float32Array(lanes.length * 4);
    lanes.forEach((l, i) => lane.set([l.phase, l.radius, l.height, l.seed], i * 4));
    geometry.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
    geometry.instanceCount = lanes.length;

    const uTime = uniform(0);
    const uReveal = uniform(0);
    const aLane = attribute('aLane', 'vec4');
    const aWing = attribute('aWing', 'float');
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
    const right = radial.negate().mul(cosB).sub(vec3(0, sinB, 0));
    const up = vec3(0, cosB, 0).sub(radial.mul(sinB));

    // SOARING: wings held in a shallow dihedral, with a few slow beats now and then (each bird on
    // its own clock). The outer panel lags the inner one, which is what makes it a wingbeat.
    const beating = smoothstep(0.55, 0.9, sin(uTime.mul(0.21).add(seed.mul(11.0))));
    const beat = uTime.mul(5.2).add(seed.mul(20.0));
    const wingLift = aWing.mul(float(0.2).add(beating.mul(0.5).mul(sin(beat))))
        .add(aWing.mul(aWing).mul(beating).mul(0.34).mul(sin(beat.sub(0.9))));

    const bob = sin(uTime.mul(0.23).add(seed.mul(9.0))).mul(3.0);
    const centre = vec3(...config.centre);
    const seat = centre.add(radial.mul(aLane.y)).add(vec3(0, 1, 0).mul(aLane.z.add(bob)));
    const local = positionLocal;
    const offset = right.mul(local.x)
        .add(up.mul(local.y.add(wingLift)))
        .sub(forward.mul(local.z));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = seat.add(offset.mul(float(config.size).mul(uReveal)));
    // A slate silhouette, hazed a little toward the horizon with range so the far side of the
    // kettle sits back in the air.
    const haze = hazeColour ?? vec3(0.71, 0.81, 0.91);
    const range = length(seat.sub(cameraPosition));
    material.colorNode = mix(vec3(0.085, 0.10, 0.14), haze, smoothstep(250.0, 1500.0, range).mul(0.55));
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
