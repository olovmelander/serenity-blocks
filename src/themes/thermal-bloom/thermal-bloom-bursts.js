/**
 * Thermal Bloom — the bursts: hot water thrown into the air by the events, as drops that catch
 * the sun (thermal-bloom-world.js writes their rows; three-free numbers, a closed form in time).
 *
 * A burst is one row pair in `u.bursts`: (x, y, z, start) on the wrapped clock and
 * (r, g, b, code), the colour the water takes from the mats it boils out of (the piece's) and
 * code = kind + BURST_CODE.scale · scale + BURST_CODE.life · life:
 *   splash    a lock's boil-over: drops thrown up and out on every side in the first quarter
 *             second, falling back round the foot;
 *   jet       a hard drop's plunge or a chain's vent: a narrow column of drops shot straight up;
 *   fountain  a vent that keeps playing while the chain lives: drops re-launched for `life`
 *             seconds, each on its own cycle.
 * `scale` is metres per board cell where it happened (so a burst is the same size on screen
 * beside the card at any distance). Every drop is a camera-facing streak along its own flight
 * (the eye sees a fast drop as a short line: a jet reads as one ribbon of water, never beads), at
 * least a pixel across; a few at a time send the sun back to the eye (it stands behind the
 * camera's shoulder) and flash above the bloom's knee.
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
    fract,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BURST_CODE,
    BURST_KIND,
    BURST_SLOTS,
    tbFxMaterial,
    tbHash21,
    tbPart,
} from './thermal-bloom-tsl.js';

const G = 9.81;
const TAU = Math.PI * 2;
/** How long the eye smears a drop (seconds): a streak is its speed times this. */
const STREAK = 0.12;

/**
 * The bursts' drops: `perBurst` quads for each of BURST_SLOTS bursts.
 * @param {object} u          the shared uniforms (u.bursts, u.burstCount)
 * @param {number} perBurst   drops a burst throws (the tier's)
 */
export function createBursts(u, perBurst) {
    const count = BURST_SLOTS * perBurst;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const positions = new Float32Array(count * 4 * 3);
    const seeds = new Float32Array(count * 4 * 2);
    const index = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
        corners.forEach(([x, y], c) => {
            positions.set([x, y, 0], (i * 4 + c) * 3);
            seeds.set([Math.floor(i / perBurst), i % perBurst], (i * 4 + c) * 2);
        });
        index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aBurst', new THREE.BufferAttribute(seeds, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    const aBurst = attribute('aBurst', 'vec2');
    const vCorner = varying(positionGeometry.xy, 'vBurstCorner');
    const slot = aBurst.x;
    const k = aBurst.y;
    const A = u.bursts.element(int(slot).mul(2));
    const B = u.bursts.element(int(slot).mul(2).add(1));
    const code = floor(B.w.add(0.5));
    const life = floor(code.div(BURST_CODE.life));
    const rest = code.sub(life.mul(BURST_CODE.life));
    const scaleQ = floor(rest.div(BURST_CODE.scale));
    const kind = rest.sub(scaleQ.mul(BURST_CODE.scale));
    // Metres per board cell where it happened (stored in tenths).
    const cell = max(scaleQ.div(10.0), 0.2);
    const isJet = step(abs(kind.sub(BURST_KIND.jet)), 0.5);
    const isFountain = step(abs(kind.sub(BURST_KIND.fountain)), 0.5);
    const h1 = tbHash21(vec2(k, slot.add(1.7)));
    const h2 = tbHash21(vec2(k.add(3.1), slot.mul(1.3).add(5.3)));
    const h3 = tbHash21(vec2(k.mul(1.7).add(9.1), slot));
    const h4 = tbHash21(vec2(k.add(0.37), slot.add(7.7)));
    // How high the drops climb: a splash about one to three cells, a jet four to eight, a vent
    // six to ten (each drop its own share of it).
    const top = cell.mul(mix(mix(h1.mul(2.0).add(1.0), h1.mul(4.0).add(4.0), isJet), h1.mul(4.0).add(6.0), isFountain));
    const vUp = sqrt(top.mul(2.0 * G));
    const flight = vUp.mul(2.0 / G).add(0.15);
    // When this drop leaves: a splash empties in a quarter second, a jet over half a second; a
    // fountain's drops cycle for its whole life.
    const age0 = u.time.sub(A.w);
    const launch = mix(mix(h2.mul(0.25), h2.mul(0.55), isJet), float(0.0), isFountain);
    const cycleAge = fract(age0.div(flight).add(h2)).mul(flight);
    const age = mix(age0.sub(launch), cycleAge, isFountain);
    const live = mix(step(0.0, age).mul(step(age, flight)), step(0.0, age0).mul(step(age0, life)), isFountain)
        .mul(step(slot.add(0.5), float(u.burstCount)));
    // Out to the sides: a splash flings them a cell or two (a crown of drops), a jet and a vent
    // keep them close round their column.
    const reachSplash = mix(h3.mul(1.6).add(0.4), h3.mul(0.45).add(0.08), isJet);
    const reach = cell.mul(mix(reachSplash, h3.mul(1.8).add(0.5), isFountain));
    const ang = h4.mul(TAU);
    const tt = clamp(age, 0.0, flight);
    const drop = vec3(
        A.x.add(cos(ang).mul(reach).mul(tt.div(flight).mul(1.4))).add(u.windDir.x.mul(tt).mul(0.6)),
        A.y.add(vUp.mul(tt)).sub(tt.mul(tt).mul(0.5 * G)).add(0.1),
        A.z.add(sin(ang).mul(reach).mul(tt.div(flight).mul(1.4))).add(u.windDir.y.mul(tt).mul(0.6)),
    );
    // Its velocity there (for the streak).
    const vel = vec3(
        cos(ang).mul(reach).mul(1.4).div(flight)
            .add(u.windDir.x.mul(0.6)),
        vUp.sub(tt.mul(G)),
        sin(ang).mul(reach).mul(1.4).div(flight)
            .add(u.windDir.y.mul(0.6)),
    );
    const alive = live.mul(step(A.y.sub(0.2), drop.y));
    const vId = varying(slot.mul(97.0).add(k), 'vBurstId');
    const vTint = varying(B.xyz, 'vBurstTint');
    const vJet = varying(isJet, 'vBurstJet');
    // Drops thin toward the end of their flight; a fountain fades in and out over its life.
    const fountainFade = smoothstep(0.0, 0.3, age0).mul(float(1.0).sub(smoothstep(life.sub(0.8), life, age0)));
    const fadeLife = mix(float(1.0), fountainFade, isFountain);
    const vLife = varying(alive.mul(float(1.0).sub(smoothstep(0.65, 1.0, tt.div(flight)))).mul(fadeLife), 'vBurstLife');
    // (a fountain's and a jet's drops fuller: a body of water, not threads)
    const size = cell.mul(h1.mul(0.012).add(0.01)).mul(mix(float(1.0), float(2.0), max(isFountain, isJet)));

    const material = tbFxMaterial('ThermalBloomBursts');
    const toCam = u.camPos.sub(drop);
    const d = length(toCam);
    const view = toCam.div(max(d, 1e-3));
    // The flight across the view (what the eye sees it travel), and the streak's length.
    const across = vel.sub(view.mul(dot(vel, view)));
    const speed = length(across);
    const width = max(size, d.mul(u.pixelAngle).mul(0.8));
    const halfLen = width.add(speed.mul(STREAK * 0.5));
    // A long streak spreads the same water thinner.
    const vThin = varying(width.div(halfLen).pow(0.35), 'vBurstThin');
    material.positionNode = Fn(() => {
        const axis = normalize(across.add(vec3(0.0, 1e-4, 0.0)));
        const side = normalize(cross(axis, view));
        const corner = side.mul(positionGeometry.x.mul(width)).add(axis.mul(positionGeometry.y.mul(halfLen)));
        return mix(vec3(0.0, -1e5, 0.0), drop.add(corner), alive);
    })();
    const burstFn = Fn(() => {
        const r = length(vCorner);
        // A few drops at a time catch the sun and flash (above the bloom's knee).
        const flash = step(0.93, tbHash21(vec2(vId, floor(u.time.mul(9.0)))));
        const a = smoothstep(1.0, 0.25, r).mul(vLife).mul(vThin).mul(float(0.62).add(flash.mul(0.38)));
        // Hot spring water thrown into the sun: white, a breath of the mats it boiled out of.
        const water = mix(vec3(1.0), vTint, mix(float(0.2), float(0.08), vJet));
        const col = u.sunColor.mul(water).mul(float(1.0).add(flash.mul(3.5))).add(vTint.mul(0.1));
        return vec4(col.mul(a), a);
    });
    material.colorNode = burstFn();
    return tbPart('ThermalBloomBursts', geometry, material, 64);
}

/** Pack a burst's code (see the header). `scale` metres per board cell, `life` seconds. */
export function burstCode(kind, scale, life = 0) {
    const s = Math.max(1, Math.min(BURST_CODE.life / BURST_CODE.scale - 1, Math.round(scale * 10)));
    const l = Math.max(0, Math.min(999, Math.round(life)));
    return kind + BURST_CODE.scale * s + BURST_CODE.life * l;
}
