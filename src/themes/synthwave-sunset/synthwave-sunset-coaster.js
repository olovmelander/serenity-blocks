/**
 * Synthwave Sunset — the wooden coaster on the pier: one closed circuit beside the deck. From the
 * station near the wheel the track climbs the lift hill, drops, crosses a camelback, swings round
 * a banked U-turn at the far end, runs back low on the outer line and turns again into the
 * station. Seen side-on against the sunset just left of the board.
 *
 * Three draws: the STRUCTURE (track beam, rails, the trestle's posts, girts and X-braces, the
 * station and the deck it stands on), the TRAIN (four cars, an InstancedMesh placed on the CPU
 * along the track; gameplay lifts it up the hill a notch per chain link and, when the chain
 * breaks, sends it once round the circuit back into the station) and the track's BULBS (mint and
 * lemon, synthwave-sunset-bulbs.js).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    dot,
    exp,
    float,
    fract,
    max,
    mix,
    normalWorld,
    normalize,
    positionWorld,
    pow,
    select,
    smoothstep,
} from 'three/tsl';
import { linearColor, rgb } from './synthwave-sunset-tsl.js';
import { PIER, pierFrame } from './synthwave-sunset-layout.js';
import {
    box, makeOut, strut, toGeometry, tube,
} from './synthwave-sunset-geo.js';
import { BULB, createBulbField } from './synthwave-sunset-bulbs.js';

/**
 * The circuit, in pier coordinates: metres from the pier's far end (s), across the pier (c), and
 * height above the deck. The station faces the wheel and the lift climbs away from it, so the climb
 * (the chain's meter) is in open sky left of the board; the drop and the camelback run toward the
 * board. The return runs low, further out to sea, so it never hides the hills.
 */
export const COASTER = Object.freeze({
    /** The outbound track's line (c) and the return's. */
    across: -(PIER.width / 2 + 3.6),
    returnAcross: -(PIER.width / 2 + 10.6),
    /** Outbound: (s, height) from the station to the far turn. */
    outbound: [
        [41, 2.2], [47, 2.2], [51, 2.6], [54, 5], [61, 20.5], [64, 24.2], [66.5, 24.6], [68.5, 22],
        [72, 9], [74.5, 2.8], [77, 3.2], [80, 11.5], [82, 13.4], [84, 11.5], [86.5, 4.2], [89, 3.2],
    ],
    /** The U-turns' centres (s) and heights: the far one bulges seaward, the near one landward. */
    farTurn: { s: 89, h: 3.6 },
    nearTurn: { s: 38.5, h: 2.4 },
    /** Return: (s, height) from the far turn back toward the station. */
    inbound: [
        [86, 3.8], [80, 4.6], [72, 6.4], [64, 5.0], [56, 3.6], [47, 3.0], [41.5, 2.6],
    ],
    /** Where (s, on the outbound line) the station, the lift's foot and its crest stand. */
    stationAt: 44,
    liftFootAt: 51,
    liftTopAt: 66.5,
    cars: 4,
});

/** The circuit's control points in world space, in running order (a closed loop). */
export function coasterPoints(frame = pierFrame()) {
    const { deckY } = PIER;
    const c0 = COASTER.across;
    const c1 = COASTER.returnAcross;
    const cm = (c0 + c1) / 2;
    const r = (c0 - c1) / 2;
    const pts = COASTER.outbound.map(([s, h]) => frame.at(s, c0, deckY + h));
    // The far U-turn: from the outbound line round to the return line, bulging away from the wheel.
    for (const phi of [Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI]) {
        pts.push(frame.at(COASTER.farTurn.s + r * Math.sin(phi), cm + r * Math.cos(phi), deckY + COASTER.farTurn.h));
    }
    COASTER.inbound.forEach(([s, h]) => pts.push(frame.at(s, c1, deckY + h)));
    // The near U-turn: from the return line back to the outbound line, bulging toward the wheel.
    for (const phi of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI]) {
        pts.push(frame.at(COASTER.nearTurn.s - r * Math.sin(phi), cm - r * Math.cos(phi), deckY + COASTER.nearTurn.h));
    }
    return pts;
}

/** The track as a smooth closed curve in world space (centripetal Catmull-Rom). */
export function coasterCurve(frame = pierFrame()) {
    return new THREE.CatmullRomCurve3(coasterPoints(frame), true, 'centripetal');
}

/**
 * Track parameters (0..1, by arc length) of the circuit's landmarks: the station, the lift's foot
 * and crest (on the outbound line), and the start of the return (after the far turn, where the
 * brakes come on).
 */
export function coasterMarks(curve, frame = pierFrame()) {
    const N = 4000;
    const p = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const on = (t) => {
        curve.getPointAt(t, p);
        rel.copy(p).sub(frame.far);
        return { s: rel.dot(frame.along), c: rel.dot(frame.across) };
    };
    const find = (sTarget, cLine, from = 0, to = 1) => {
        let best = from;
        let bestErr = Infinity;
        for (let i = Math.floor(from * N); i <= Math.floor(to * N); i += 1) {
            const t = i / N;
            const { s, c } = on(t);
            if (Math.abs(c - cLine) > 1) continue;
            const err = Math.abs(s - sTarget);
            if (err < bestErr) {
                bestErr = err;
                best = t;
            }
        }
        return best;
    };
    const station = find(COASTER.stationAt, COASTER.across, 0, 0.3);
    const liftFoot = find(COASTER.liftFootAt, COASTER.across, 0, 0.4);
    const liftTop = find(COASTER.liftTopAt, COASTER.across, 0, 0.6);
    const returnStart = find(COASTER.inbound[0][0], COASTER.returnAcross, liftTop, 1);
    return {
        station, liftFoot, liftTop, returnStart,
    };
}

const KIND = {
    timber: 0, steel: 1, station: 2, track: 3,
};

function buildCoaster(frame, curve) {
    const out = makeOut();
    const timber = [KIND.timber, 0, 0, 0];
    const steel = [KIND.steel, 0, 0, 0];
    const B = frame.basis;
    const deck = PIER.deckY;
    const c0 = COASTER.across;
    const c1 = COASTER.returnAcross;

    // The deck it stands on: an extension beside the pier wide enough for both lines and both
    // turns, joined to the pier's edge, on its own piles.
    const s0 = COASTER.nearTurn.s - 6;
    const s1 = COASTER.farTurn.s + 6;
    const cHi = -PIER.width / 2;
    const cLo = c1 - 3;
    box(
        out,
        frame.at((s0 + s1) / 2, (cHi + cLo) / 2, deck - PIER.deckThickness / 2),
        new THREE.Vector3((s1 - s0) / 2, PIER.deckThickness / 2, (cHi - cLo) / 2),
        timber,
        B,
    );
    const pileLines = [cHi - 1.4, c0 - 2.0, c1 + 1.6, cLo + 0.6];
    for (let s = s0 + 1.5; s < s1; s += PIER.bentSpacing) {
        for (const c of pileLines) strut(out, frame.at(s, c, -3), frame.at(s, c, deck - PIER.deckThickness), 0.32, 6, timber);
    }

    // Track: a square timber beam round the whole circuit (aCoaster.y = its track parameter, for
    // the meter and the ride's trail of light), two steel rails on it.
    const N = 300;
    const samples = curve.getSpacedPoints(N).slice(0, N);
    tube(out, samples, 0.42, 4, true, (i) => [KIND.track, i / N, 0, 0]);
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const rails = [[], []];
    samples.forEach((p, i) => {
        tangent.copy(curve.getTangentAt(i / N));
        side.crossVectors(tangent, up).normalize();
        rails[0].push(p.clone().addScaledVector(side, 0.55).add(new THREE.Vector3(0, 0.42, 0)));
        rails[1].push(p.clone().addScaledVector(side, -0.55).add(new THREE.Vector3(0, 0.42, 0)));
    });
    rails.forEach((r) => tube(out, r, 0.09, 4, true, steel));

    // Trestle: a bent every 2.2 m round the circuit, two posts, girts up its height, X-braces.
    const length = curve.getLength();
    const bents = Math.floor(length / 2.2);
    let prev = null;
    for (let b = 0; b < bents; b += 1) {
        const t = b / bents;
        const p = curve.getPointAt(t);
        const h = p.y - 0.4;
        if (h < deck + 1.2) {
            prev = null;
            continue;
        }
        tangent.copy(curve.getTangentAt(t));
        side.crossVectors(tangent, up).normalize();
        const posts = [-0.9, 0.9].map((d) => [
            new THREE.Vector3(p.x + side.x * d, deck, p.z + side.z * d),
            new THREE.Vector3(p.x + side.x * d, h, p.z + side.z * d),
        ]);
        posts.forEach(([a, top]) => strut(out, a, top, 0.11, 4, timber));
        for (let y = deck + 2.6; y < h - 0.6; y += 2.6) {
            strut(out, posts[0][0].clone().setY(y), posts[1][0].clone().setY(y), 0.06, 4, timber);
        }
        // X-brace across the bent and a diagonal to the previous bent.
        strut(out, posts[0][0], posts[1][1], 0.05, 3, timber);
        if (prev) {
            const yTop = Math.min(h, prev.h) - 0.6;
            strut(out, prev.foot, new THREE.Vector3(p.x, yTop, p.z), 0.05, 3, timber);
        }
        prev = { foot: new THREE.Vector3(p.x, deck, p.z), h };
    }

    // The station: a little roof over the platform.
    const st = frame.at(COASTER.stationAt + 1, c0, deck + 3.6);
    box(out, st, new THREE.Vector3(5, 0.25, 2.8), [KIND.station, 0, 0, 0], B);
    for (const ds of [-4.6, 4.6]) {
        for (const dc of [-2.4, 2.4]) {
            const s = COASTER.stationAt + 1 + ds;
            strut(out, frame.at(s, c0 + dc, deck), frame.at(s, c0 + dc, deck + 3.4), 0.1, 4, steel);
        }
    }
    return { out };
}

function createCoasterMaterial(u, name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.fog = false;
    const meta = attribute('aCoaster', 'vec4');
    material.colorNode = Fn(() => {
        // Pinned before the branches below: three assigns its normal builtins where they are
        // first built, so a normal first read inside one branch is zero (then NaN) in the others.
        const V = normalize(positionWorld.sub(cameraPosition)).toVar();
        const N = normalize(normalWorld).toVar();
        const kind = meta.x;
        const facing = abs(dot(N, V));
        const duskLight = mix(float(1.0), float(0.55), u.dusk);
        const sky = rgb(0x8a7aa8, 0.3).mul(float(0.55).add(max(N.y, 0.0).mul(0.45))).mul(duskLight);
        const rim = pow(float(1.0).sub(facing), 3.0).mul(max(dot(N, u.sunDir), 0.0).mul(0.8).add(0.2))
            .mul(rgb(0xff8a5c, 0.55)).mul(mix(float(1.0), float(0.35), u.dusk));
        // The track's bulbs wash the beam and the top of the trestle.
        const glow = rgb(0xbff0e0, 0.05).mul(u.pierGlow);
        const timber = rgb(0x3a2a30).mul(sky).add(rim.mul(0.7)).add(glow.mul(0.5));
        const steel = rgb(0xd8d0dc).mul(sky.add(glow)).add(rim);
        const station = rgb(0xff8ab8).mul(sky.add(rgb(0xffb070, 0.3).mul(u.pierGlow))).add(rim);
        // The beam: lemon from the lift's foot up to the meter while a chain lifts the train, as
        // bright as the chain's charge (it drains down the lift when the chain lets go); a trail
        // of light behind the train on a ride (wrapping round the circuit), longer for a longer
        // chain.
        const tt = meta.y;
        const lifted = smoothstep(u.coasterFoot.sub(0.01), u.coasterFoot.add(0.01), tt)
            .mul(float(1.0).sub(smoothstep(u.coasterMeter.sub(0.004), u.coasterMeter, tt)))
            .mul(smoothstep(0.0, 0.02, u.coasterMeter))
            .mul(u.coasterCharge ?? float(1.0));
        const behind = fract(u.coasterTrain.sub(tt));
        const trail = smoothstep(0.0, 0.003, behind).mul(exp(behind.mul(u.coasterTrail ?? float(34.0)).negate()))
            .mul(u.coasterRide);
        const beamLight = rgb(0xffe46a, 2.6).mul(lifted).add(rgb(0x7ff0d4, 3.0).mul(trail));
        const beam = timber.add(beamLight);
        return select(kind.lessThan(0.5), timber, select(kind.lessThan(1.5), steel, select(kind.lessThan(2.5), station, beam)));
    })();
    return material;
}

/** The train: four open cars, placed along the track on the CPU (instance matrices). */
function createTrain(u) {
    const out = makeOut();
    box(out, new THREE.Vector3(0, 0.75, 0), new THREE.Vector3(1.05, 0.45, 0.8), [2, 0, 0, 0]);
    box(out, new THREE.Vector3(-0.85, 1.35, 0), new THREE.Vector3(0.18, 0.25, 0.75), [2, 0, 0, 0]);
    const geometry = toGeometry(out, 'aCoaster');
    // Its own material (a graph of its own): pastel cars lit by the dusk sky and the bulbs.
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveCoasterTrain';
    material.fog = false;
    material.colorNode = Fn(() => {
        const N = normalize(normalWorld);
        const sky = rgb(0x8a7aa8, 0.3).mul(float(0.6).add(max(N.y, 0.0).mul(0.4))).mul(mix(float(1.0), float(0.55), u.dusk));
        return rgb(0xff8ab8).mul(sky.add(rgb(0xffe46a, 0.25).mul(u.coasterRide.add(0.3))));
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, COASTER.cars);
    mesh.name = 'SynthwaveCoasterTrain';
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * @param {object} u  world uniforms (coasterMeter, coasterRide, coasterTrain, coasterFoot, …)
 * @param {object} [opts]
 * @param {number} [opts.mirrorLayer]
 * @returns {THREE.Group} with userData.curve (the closed circuit), userData.marks (its landmarks'
 *   track parameters) and userData.placeTrain(t) placing the lead car at track parameter t
 */
export function createCoaster(u, opts = {}) {
    const frame = pierFrame();
    const curve = coasterCurve(frame);
    const marks = coasterMarks(curve, frame);
    if (u.coasterFoot) u.coasterFoot.value = marks.liftFoot;
    const { out } = buildCoaster(frame, curve);
    const group = new THREE.Group();
    group.name = 'SynthwaveCoaster';
    const structure = new THREE.Mesh(toGeometry(out, 'aCoaster'), createCoasterMaterial(u, 'SynthwaveCoaster'));
    structure.name = 'SynthwaveCoasterStructure';
    structure.renderOrder = -6;
    structure.frustumCulled = false;

    // Bulbs: both sides of the beam, every 0.9 m round the circuit, mint with every fifth lemon.
    const rows = [];
    const n = Math.floor(curve.getLength() / 0.9);
    const mint = linearColor(0x7ff0d4);
    const lemon = linearColor(0xffe46a);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3();
    for (let i = 0; i < n; i += 1) {
        const t = i / n;
        const p = curve.getPointAt(t);
        side.crossVectors(curve.getTangentAt(t), up).normalize();
        for (const d of [0.95, -0.95]) {
            rows.push({
                p: p.clone().addScaledVector(side, d).add(new THREE.Vector3(0, 0.1, 0)),
                size: 0.2,
                color: i % 5 === 0 ? lemon : mint,
                program: BULB.track,
                index: i,
                count: n,
                along: t,
                level: d > 0 ? 0.45 : 0.6,
            });
        }
    }
    const bulbs = createBulbField(u, rows, { name: 'SynthwaveCoasterBulbs', mirrorLayer: opts.mirrorLayer });
    const train = createTrain(u);
    group.add(structure, train, bulbs);
    if (Number.isInteger(opts.mirrorLayer)) {
        structure.layers.enable(opts.mirrorLayer);
        train.layers.enable(opts.mirrorLayer);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tangent = new THREE.Vector3();
    const p = new THREE.Vector3();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    const length = curve.getLength();
    group.userData.curve = curve;
    group.userData.marks = marks;
    group.userData.placeTrain = (t) => {
        for (let k = 0; k < COASTER.cars; k += 1) {
            // Cars trail the lead round the circuit.
            const tk = ((((t - (k * 2.6) / length) % 1) + 1) % 1);
            curve.getPointAt(tk, p);
            p.y += 0.45;
            curve.getTangentAt(tk, tangent);
            q.setFromUnitVectors(xAxis, tangent);
            m.compose(p, q, scale);
            train.setMatrixAt(k, m);
        }
        train.instanceMatrix.needsUpdate = true;
    };
    group.userData.placeTrain(marks.station);
    group.userData.meshes = [structure, train, bulbs];
    return group;
}
