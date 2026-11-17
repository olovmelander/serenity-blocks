/**
 * Synthwave Sunset — the life of the place: the people out on the pier for the evening, the
 * sailing boats crossing the bay, and the barge the fireworks rise from.
 *
 * Two draws, both on the mirror layer (the sea reflects them):
 *
 *   The STROLLERS. One instanced draw of upright cards turned to the eye about the vertical, each
 *   a figure drawn in the fragment stage (a head, shoulders tapering to a waist, two legs that
 *   scissor with the distance walked, so nobody slides) and cut out with `maskNode`. They walk
 *   the pier's deck at a stroller's pace, there and back (the walk is a function of the clock
 *   alone: no state, a seek lands right), singly and in pairs, some standing at the pier head's
 *   rail under the wheel. Against the sunset they are silhouettes; after dark the railing's bulbs
 *   light them from below. Opaque, with depth: the railings, the pavilions and the sea mist treat
 *   them as they treat the pier.
 *
 *   The BOATS. One merged mesh: three sailing boats on lanes across the bay (a dinghy close in,
 *   a sloop, a ketch far out), moved along their lanes in the vertex stage, and the fireworks'
 *   barge at anchor off the pier's end. Dark hulls, pale sails that take the sky's light and glow
 *   when they cross the sun's bearing, a masthead light after sunset.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    mod,
    normalWorld,
    normalize,
    positionGeometry,
    positionLocal,
    positionWorld,
    select,
    sin,
    smoothstep,
    sqrt,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SEA_HAZE, rgb, swSkyGradient, swSunAlign,
} from './synthwave-sunset-tsl.js';
import { PIER, PIER_HEAD, pierFrame } from './synthwave-sunset-layout.js';
import {
    box, makeOut, strut, toGeometry,
} from './synthwave-sunset-geo.js';
import { FIREWORKS } from './synthwave-sunset-fireworks.js';
import { flatVarying } from '../shared/flat-varying.js';

/** A stroller's card (m): wide enough for a stride, a little taller than the tallest figure. */
const CARD = Object.freeze({ width: 1.0, height: 2.0 });
/** The stretch of the pier the strollers walk (metres from the wheel's end). */
export const STROLL = Object.freeze({ from: PIER_HEAD.s1 + 2, margin: 6 });
/** Clothes: dusk-dark, with a few pale summer things among them (sRGB). */
const CLOTHES = [0x2a2438, 0x3a2c44, 0x1f2c3c, 0x46303c, 0xd8c8c0, 0xc88a9a, 0x7fb8b0, 0xe0c890];

/**
 * The strollers' layout: per figure (start along the pier m, across the deck m, speed m/s,
 * phase) and (height m, clothes index, standing 0|1, 0). Pure (a seeded walk), for the tests.
 * @param {number} count
 * @param {number} pierLength the pier's length (m)
 */
export function strollerRows(count, pierLength) {
    const rows = [];
    // A small generator of its own: the walk must not shift the world's random sequence.
    let seed = 0x5eed1e;
    const rand = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const half = PIER.width / 2;
    const span = pierLength - STROLL.margin - STROLL.from;
    const standing = Math.max(2, Math.round(count * 0.16));
    for (let i = 0; i < count; i += 1) {
        const height = 1.55 + rand() * 0.3;
        const clothes = Math.floor(rand() * CLOTHES.length);
        if (i < standing) {
            // At the pier head's rail, watching the sea (the side the eye sees).
            rows.push([
                PIER_HEAD.s0 + 1.5 + rand() * (PIER_HEAD.s1 - PIER_HEAD.s0 - 3), PIER_HEAD.halfAcross - 0.7 - rand() * 0.5, 0, rand() * 6.28,
                height, clothes, 1, 0,
            ]);
            continue;
        }
        // The near side of the deck mostly (it is the side seen), a few across the way.
        const side = rand() < 0.78 ? 1 : -1;
        const across = side * (half - 0.9 - rand() * 2.2);
        const speed = (0.75 + rand() * 0.55) * (rand() < 0.5 ? 1 : -1);
        const row = [rand() * span, across, speed, rand() * 6.28, height, clothes, 0, 0];
        rows.push(row);
        // Now and then a companion walks beside.
        if (i + 1 < count && rand() < 0.35) {
            i += 1;
            rows.push([row[0] + 0.15, across - side * 0.62, speed, rand() * 6.28, 1.5 + rand() * 0.32, Math.floor(rand() * CLOTHES.length), 0, 0]);
        }
    }
    return rows;
}

function createStrollers(u, count, mirrorLayer) {
    const frame = pierFrame();
    const rows = strollerRows(count, frame.length);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const A = new Float32Array(rows.length * 4);
    const B = new Float32Array(rows.length * 4);
    rows.forEach((row, i) => {
        A.set(row.slice(0, 4), i * 4);
        B.set(row.slice(4, 8), i * 4);
    });
    geometry.setAttribute('iWalkA', new THREE.InstancedBufferAttribute(A, 4));
    geometry.setAttribute('iWalkB', new THREE.InstancedBufferAttribute(B, 4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveStrollers';
    material.fog = false;
    material.side = THREE.DoubleSide;

    const a = attribute('iWalkA', 'vec4');
    const b = attribute('iWalkB', 'vec4');
    const span = frame.length - STROLL.margin - STROLL.from;
    // The walk: there and back along the stretch on the gulls' clock (held back under reduced
    // motion), so a figure turns round at the ends instead of vanishing. Standing figures stay.
    const clock = u.gullTime ?? u.time;
    const lap = mod(a.x.add(a.z.mul(clock)), span * 2);
    const walked = float(span).sub(abs(lap.sub(span)));
    const along = mix(walked.add(STROLL.from), a.x, b.z);
    const far = vec3(frame.far.x, PIER.deckY, frame.far.z);
    const foot = far.add(vec3(frame.along.x, 0.0, frame.along.z).mul(along))
        .add(vec3(frame.across.x, 0.0, frame.across.z).mul(a.y));
    // Turned to the eye about the vertical.
    const toEye = cameraPosition.sub(foot);
    const right = normalize(vec3(toEye.z, 0.0, toEye.x.negate()));
    const corner = positionGeometry.xy;
    const world = foot.add(right.mul(corner.x.mul(CARD.width)))
        .add(vec3(0.0, corner.y.add(0.5).mul(CARD.height), 0.0));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

    const figure = flatVarying(vec4(b.x, b.y, b.z, a.w), 'vStroller');
    // The stride's phase rides on the distance walked, so the feet do not slide.
    const stride = flatVarying(along.mul(4.4).add(a.w), 'vStride');

    const shape = Fn(() => {
        const q = uv();
        const h = figure.x;
        const x = q.x.sub(0.5).mul(CARD.width);
        const y = q.y.mul(CARD.height);
        // Head, a torso from the shoulders in to the waist, two legs from the hip to the feet.
        const head = length(vec2(x, y.sub(h.mul(0.92)))).sub(h.mul(0.062));
        const up = clamp(y.sub(h.mul(0.5)).div(h.mul(0.33)), 0.0, 1.0);
        const waist = abs(x).sub(mix(h.mul(0.075), h.mul(0.115), up));
        const torso = max(waist, abs(y.sub(h.mul(0.665))).sub(h.mul(0.165)));
        const swing = sin(stride).mul(h.mul(0.13)).mul(float(1.0).sub(figure.z));
        const down = clamp(float(1.0).sub(y.div(h.mul(0.5))), 0.0, 1.0);
        const legA = abs(x.sub(swing.mul(down)).sub(h.mul(0.03))).sub(h.mul(0.034));
        const legB = abs(x.add(swing.mul(down)).add(h.mul(0.03))).sub(h.mul(0.034));
        const legs = max(min(legA, legB), y.sub(h.mul(0.52)));
        return min(min(head, torso), legs);
    });
    material.maskNode = shape().lessThan(0.0);

    material.colorNode = Fn(() => {
        const idx = figure.y;
        const pick = (k) => clamp(float(1.0).sub(abs(idx.sub(k))), 0.0, 1.0);
        let cloth = vec3(0.0);
        CLOTHES.forEach((hex, k) => { cloth = cloth.add(rgb(hex).mul(pick(k))); });
        const y = uv().y.mul(CARD.height);
        // The evening's own light from above; the railing's bulbs from below once they are lit.
        const sky = float(0.34).mul(u.ambient);
        const lit = u.pierGlow.mul(u.pierPower);
        const bulbs = exp(y.mul(-0.9)).mul(0.5).add(0.12).mul(lit);
        return cloth.mul(sky).add(cloth.mul(rgb(0xffb878)).mul(bulbs));
    })();

    const mesh = new THREE.InstancedMesh(geometry, material, rows.length);
    mesh.name = 'SynthwaveStrollers';
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    if (Number.isInteger(mirrorLayer)) mesh.layers.enable(mirrorLayer);
    return mesh;
}

/**
 * The boats' courses. Each sails there and back along a line square to the eye (z, m): round
 * `centre` (x, m) by `reach` either way, a whole course every `period` seconds, starting at
 * `phase`; slowest where it comes about. The sea mist takes anything much past the pier's end, so
 * they sail close in: a dinghy between the beach and the pier, across the sun's road and in front
 * of the wheel; a sloop past the fireworks' barge and behind the wheel; a ketch further out.
 */
export const BOAT_LANES = Object.freeze([
    Object.freeze({
        z: -72, centre: -70, reach: 85, period: 260, phase: 0.9, length: 6.2, mast: 8.2, masts: 1,
    }),
    Object.freeze({
        z: -215, centre: -80, reach: 150, period: 380, phase: 3.6, length: 11, mast: 15, masts: 1,
    }),
    Object.freeze({
        z: -420, centre: -60, reach: 260, period: 520, phase: 5.2, length: 21, mast: 25, masts: 2,
    }),
]);

const BOAT = Object.freeze({
    hull: 0, sail: 1, light: 2, barge: 3,
});

/** Where lane `i`'s boat is along x at `time` (the vertex stage's twin). */
export function boatX(i, time) {
    const lane = BOAT_LANES[i];
    return lane.centre + lane.reach * Math.sin((time * Math.PI * 2) / lane.period + lane.phase);
}

/** A triangle seen from both sides. */
function sail(out, a, b, c, meta) {
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const flip of [1, -1]) {
        const base = out.position.length / 3;
        for (const p of [a, b, c]) {
            out.position.push(p.x, p.y, p.z);
            out.normal.push(n.x * flip, n.y * flip, n.z * flip);
            out.meta.push(meta[0], meta[1], meta[2], meta[3]);
        }
        if (flip > 0) out.index.push(base, base + 1, base + 2);
        else out.index.push(base, base + 2, base + 1);
    }
}

function buildBoats() {
    const out = makeOut();
    BOAT_LANES.forEach((lane, i) => {
        const dir = 1;
        const L = lane.length;
        const beam = L * 0.26;
        const free = L * 0.085;
        const P = (x, y, z = 0) => new THREE.Vector3(x * dir, y, z);
        const hull = [BOAT.hull, i, 0, 0];
        box(out, P(0, free * 0.5), new THREE.Vector3(L / 2, free * 0.5, beam / 2), hull);
        // A raised bow and a low cabin.
        box(out, P(L * 0.42, free * 0.75), new THREE.Vector3(L * 0.1, free * 0.75, beam * 0.36), hull);
        box(out, P(-L * 0.08, free * 1.35), new THREE.Vector3(L * 0.17, free * 0.35, beam * 0.3), hull);
        const rig = (at, height, reach) => {
            strut(out, P(at, free), P(at, height), L * 0.008 + 0.04, 5, hull);
            sail(out, P(at - L * 0.012, height * 0.97), P(at - L * 0.012, free + L * 0.1), P(at - reach, free + L * 0.1), [BOAT.sail, i, 0, 0]);
            box(out, P(at, height + 0.2), new THREE.Vector3(0.16, 0.16, 0.16), [BOAT.light, i, 0, 0]);
        };
        const mastAt = L * (lane.masts > 1 ? 0.16 : 0.06);
        rig(mastAt, lane.mast, L * 0.46);
        // The jib, from the masthead down to the bow.
        sail(out, P(mastAt + L * 0.012, lane.mast * 0.9), P(L * 0.5, free * 1.5), P(mastAt + L * 0.03, free + L * 0.12), [BOAT.sail, i, 0, 0]);
        if (lane.masts > 1) rig(-L * 0.27, lane.mast * 0.72, L * 0.2);
    });
    // The fireworks' barge at anchor: a low hull with its mortar racks.
    const { barge } = FIREWORKS;
    const at = (x, y, z) => new THREE.Vector3(barge.x + x, y, barge.z + z);
    const meta = [BOAT.barge, 0, 0, 0];
    box(out, at(0, 0.55, 0), new THREE.Vector3(13, 0.55, 4.2), meta);
    for (let k = -2; k <= 2; k += 1) box(out, at(k * 4.2, 1.45, 0), new THREE.Vector3(1.3, 0.4, 1.6), meta);
    box(out, at(-10.5, 1.9, 0), new THREE.Vector3(1.6, 0.85, 1.8), meta);
    return out;
}

function createBoats(u, mirrorLayer) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveBoats';
    material.fog = false;
    material.side = THREE.DoubleSide;
    const meta = attribute('aBoat', 'vec4');
    const kind = meta.x;
    const laneOf = (key) => {
        const [l0, l1, l2] = BOAT_LANES;
        return select(meta.y.lessThan(0.5), float(l0[key]), select(meta.y.lessThan(1.5), float(l1[key]), float(l2[key])));
    };

    material.positionNode = Fn(() => {
        const phase = u.time.mul(Math.PI * 2).div(laneOf('period')).add(laneOf('phase')).toVar();
        const x = laneOf('centre').add(laneOf('reach').mul(sin(phase)));
        // The boat points the way it sails; coming about, it turns through the eye's line (its
        // length closes up and opens out the other way) instead of flipping.
        const way = cos(phase);
        const heading = way.div(sqrt(way.mul(way).add(0.03)));
        // A slow pitch and heave on the swell, each boat on its own beat.
        const beat = u.time.mul(0.7).add(meta.y.mul(2.1));
        const heave = sin(beat).mul(0.12).mul(u.seaState);
        const pitch = cos(beat.mul(0.83)).mul(0.02).mul(u.seaState);
        const local = positionGeometry;
        const sailing = vec3(
            local.x.mul(heading).add(x),
            local.y.add(heave).add(local.x.mul(pitch)),
            local.z.add(laneOf('z')),
        );
        return select(kind.greaterThan(2.5), positionLocal, sailing);
    })();

    material.colorNode = Fn(() => {
        const V = normalize(positionWorld.sub(cameraPosition)).toVar();
        const N = normalize(normalWorld).toVar();
        const dist = length(positionWorld.sub(cameraPosition));
        const hLen = max(length(vec2(V.x, V.z)), 1e-4);
        const sa = swSunAlign(dot(vec2(V.x, V.z).div(hLen), u.sunAz));
        const sunUp = smoothstep(-0.16, 0.06, u.sunDir.y);
        const hull = rgb(0x1c1622).mul(u.ambient).add(u.sunBand.mul(max(N.y, 0.0).mul(0.06)));
        // Sailcloth against the evening: dark like the hull, the low sun glowing through it on
        // the sun's own bearing, pale again under the golden hour's daylight.
        const cloth = mix(rgb(0x3a2c3c), rgb(0xf0e2d6), u.gold.mul(0.7)).mul(u.ambient.mul(0.5))
            .add(u.sunWarm.mul(sa.mul(sa).mul(sunUp).mul(0.3)));
        const lamp = rgb(0xffd9a0, 3.0).mul(smoothstep(0.25, 0.7, u.dusk));
        const col = select(kind.lessThan(0.5), hull, select(kind.lessThan(1.5), cloth, select(kind.lessThan(2.5), lamp, hull)));
        const haze = float(1.0).sub(exp(dist.mul(-SEA_HAZE)));
        const isLamp = kind.greaterThan(1.5).and(kind.lessThan(2.5));
        const hazed = mix(col, swSkyGradient(u, normalize(vec3(V.x, 0.0, V.z))).color, haze.mul(0.45));
        return select(isLamp, col, hazed);
    })();

    const mesh = new THREE.Mesh(toGeometry(buildBoats(), 'aBoat'), material);
    mesh.name = 'SynthwaveBoats';
    mesh.frustumCulled = false;
    mesh.renderOrder = -8;
    if (Number.isInteger(mirrorLayer)) mesh.layers.enable(mirrorLayer);
    return mesh;
}

/**
 * @param {object} u  world uniforms (time, gullTime, ambient, pierGlow, pierPower, the sun's frame,
 *                    tonight's colours, seaState, dusk)
 * @param {object} [opts]
 * @param {number} [opts.strollers=36]  figures on the pier (a tier's count; 0 = none)
 * @param {number} [opts.mirrorLayer]
 * @returns {THREE.Group}
 */
export function createLife(u, opts = {}) {
    const group = new THREE.Group();
    group.name = 'SynthwaveLife';
    const count = opts.strollers ?? 36;
    if (count > 0) group.add(createStrollers(u, count, opts.mirrorLayer));
    group.add(createBoats(u, opts.mirrorLayer));
    return group;
}
