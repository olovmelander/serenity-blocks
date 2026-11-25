/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview LIFE IN THE CITY'S AIR (2026-11-17 masterpiece pass): steam, searchlights, the
 * sun's shafts, the hologram.
 *
 *   Steam        plumes off the street's vents and the roofs' air handlers: soft sprites that rise,
 *                widen, lean on the wind and thin out, lit by the signs they pass (the glow map) and
 *                thicker while it rains. One instanced draw, closed form in the clock.
 *   Searchlights slow beams from four far roofs, sweeping the cloud (the sweep is written in the
 *                vertex stage from the same sines as odyssey-neon-clock.js `resolveNeonSearchlight`).
 *   Shafts       the low sun's light in the canyon's air: a few camera-facing slices between the eye
 *                and the sun, each a fan of rays about the sun's place, depth-tested, so the towers
 *                between stand in front of the farther rays and behind the nearer ones.
 *   Hologram     a globe of light turning over a roof to the right of the boulevard: the Earth the
 *                journey began in, drawn in scan lines, a ring round it.
 *
 * All are pure added light (premultiplied, alpha 0), fade through the 7->8 carry with `uOpacity`
 * and `seamReveal`, and are left out of the Low tier.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    modelViewMatrix,
    normalGeometry,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { STREET_Y, mulberry32 } from './odyssey-neon-city-plan.js';
import { neonCityPos, neonGlow, neonIgnition } from './odyssey-neon-light.tsl.js';
import { latticeNoise3 } from './odyssey-lattice-noise.js';

function quadGeometry(count, attributes, corners = [-1, -1, 1, 1]) {
    const [x0, y0, x1, y1] = corners;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    Object.entries(attributes).forEach(([name, [data, size]]) => {
        geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size));
    });
    geometry.instanceCount = count;
    return geometry;
}

function additive(name) {
    const uOpacity = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.depthWrite = false;
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.uniforms = { uOpacity };
    return { material, uOpacity };
}

// ── Steam ────────────────────────────────────────────────────────────────────────

export const NEON_STEAM = Object.freeze({
    puffs: 5, streetSpacing: 46, streetX: 17.4, zNear: 64, zFar: -430, roofMax: 34,
});

/**
 * Where steam rises: the street's vents down both kerbs, and the air handlers on the roofs
 * about the boulevard.
 * @param {{ boxes: object[] }} gear planNeonArchitecture().gear
 * @returns {{ x: number, y: number, z: number, height: number, size: number, seed: number }[]}
 */
export function planNeonVents(gear) {
    const E = NEON_STEAM;
    const rand = mulberry32(0x57ea3);
    const vents = [];
    for (let z = E.zNear; z > E.zFar; z -= E.streetSpacing) {
        [-1, 1].forEach((side) => {
            vents.push({
                x: side * (E.streetX + (rand() * 3)),
                y: STREET_Y + 0.3,
                z: z + ((rand() - 0.5) * 20),
                height: 13 + (rand() * 9),
                size: 2.6 + (rand() * 1.6),
                seed: rand(),
            });
        });
    }
    const roofs = (gear?.boxes || []).filter((box) => box.kind === 2
        && Math.abs(box.x) < 130 && box.z < 80 && box.z > -340 && box.y < 24);
    const stride = Math.max(1, Math.ceil(roofs.length / E.roofMax));
    roofs.forEach((box, i) => {
        if (i % stride !== 0) return;
        vents.push({
            x: box.x, y: box.y + (box.height * 0.5), z: box.z, height: 8 + (rand() * 6), size: 1.9 + (rand() * 1.3), seed: rand(),
        });
    });
    return vents;
}

/**
 * @param {object} N neon uniforms
 * @param {ReturnType<typeof planNeonVents>} vents
 */
export function createNeonSteam(N, vents) {
    const E = NEON_STEAM;
    const count = vents.length * E.puffs;
    const aVent = new Float32Array(count * 4);
    const aPuff = new Float32Array(count * 4);
    vents.forEach((vent, v) => {
        for (let k = 0; k < E.puffs; k += 1) {
            const i = (v * E.puffs) + k;
            aVent.set([vent.x, vent.y, vent.z, vent.seed], i * 4);
            aPuff.set([vent.height, vent.size, k / E.puffs, (vent.seed * 13.7) + (k * 0.618)], i * 4);
        }
    });
    const geometry = quadGeometry(count, { aSteamVent: [aVent, 4], aSteamPuff: [aPuff, 4] });
    const { material, uOpacity } = additive('odyssey-neon-steam');
    const vent = attribute('aSteamVent', 'vec4');
    const puff = attribute('aSteamPuff', 'vec4');
    const age = fract(N.uTime.mul(vent.w.mul(0.05).add(0.11)).add(puff.z).add(vent.w));
    const rise = age.mul(puff.x);
    // The wind leans the plume, more the higher it has risen; a slow wobble keeps it alive.
    const lean = age.mul(age).mul(puff.x).mul(0.45);
    const wobble = sin(N.uTime.mul(0.7).add(puff.w.mul(6.0))).mul(age).mul(0.9);
    const centre = vec3(vent.x.add(lean).add(wobble), vent.y.add(rise), vent.z.add(wobble.mul(0.5)));
    const view = modelViewMatrix.mul(vec4(centre, 1.0));
    const size = puff.y.mul(age.mul(1.5).add(0.4));
    // Taller than wide: a plume, not a ball.
    material.vertexNode = cameraProjectionMatrix.mul(vec4(
        view.xy.add(positionGeometry.xy.mul(vec2(size.mul(0.72), size.mul(1.25)))),
        view.z,
        1.0,
    ));
    // Lit by what it passes: the shopfronts low down, the signs higher, the mist's own glow.
    const ign = neonIgnition(N, centre);
    const hAbove = max(centre.y.sub(STREET_Y), 0.0);
    const light = neonGlow(N, centre, 1).mul(exp(hAbove.mul(-1 / 24))).mul(1.5)
        .add(neonGlow(N, centre, 0).mul(0.5))
        .mul(ign.level)
        .add(N.mistLow.mul(2.2))
        .add(N.sky.haze.mul(1.4));
    const fade = smoothstep(0.0, 0.14, age).mul(float(1.0).sub(age)).mul(float(1.0).sub(age));
    const vLight = varying(light.mul(fade).mul(N.uRainDensity.mul(0.6).add(0.75)).mul(N.seamReveal), 'vSteamLight');
    const vSeed = varying(vec2(puff.w, age), 'vSteamSeed');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r = length(q);
        const n = latticeNoise3(vec3(q.x.mul(1.4).add(vSeed.x.mul(3.0)), q.y.mul(1.4).sub(vSeed.y.mul(1.6)), vSeed.x.mul(7.0)));
        // Eaten away by the noise from its edge inward: wisps, never a disc with a rim.
        const body = smoothstep(0.42, 0.95, float(1.0).sub(r).mul(n.mul(1.25).add(0.3)));
        return vec4(vLight.mul(body).mul(0.3).mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-steam';
    mesh.frustumCulled = false;
    mesh.renderOrder = 35;
    return mesh;
}

// ── Searchlights ─────────────────────────────────────────────────────────────────

/** The lamps: [x, z of the roof they stand on is found in the plan], sweep in radians and seconds. */
export const NEON_SEARCHLIGHTS = Object.freeze([
    Object.freeze({
        side: -1, z: -230, bearing: 0.5, swing: 0.5, period: 31, phase: 0.4, elevation: 1.0, nod: 0.16,
    }),
    Object.freeze({
        side: 1, z: -300, bearing: -0.45, swing: 0.55, period: 37, phase: 2.2, elevation: 0.95, nod: 0.18,
    }),
    Object.freeze({
        side: -1, z: -470, bearing: 0.3, swing: 0.6, period: 43, phase: 4.1, elevation: 1.08, nod: 0.14,
    }),
    Object.freeze({
        side: 1, z: -520, bearing: -0.25, swing: 0.5, period: 29, phase: 5.3, elevation: 1.12, nod: 0.15,
    }),
]);

/**
 * Seat each lamp on the roof of the tallest dealt tower near its place.
 * @param {object[]} towers dealCityTowers()
 */
export function planNeonSearchlights(towers) {
    return NEON_SEARCHLIGHTS.map((lamp) => {
        let best = null;
        towers.forEach((tower) => {
            if (tower.side !== lamp.side || tower.bank < 1 || tower.bank > 3) return;
            if (Math.abs(tower.z - lamp.z) > 60) return;
            if (!best || tower.height > best.height) best = tower;
        });
        const host = best ?? {
            x: lamp.side * 90, y: -20, z: lamp.z, height: 80,
        };
        return {
            ...lamp, x: host.x, y: host.y + (host.height * 0.5) + 2, z: host.z, length: 520,
        };
    });
}

/**
 * @param {object} N neon uniforms
 * @param {ReturnType<typeof planNeonSearchlights>} lamps
 */
export function createNeonSearchlights(N, lamps) {
    const count = lamps.length;
    const aPos = new Float32Array(count * 4);
    const aSweep = new Float32Array(count * 4);
    const aTilt = new Float32Array(count * 2);
    lamps.forEach((lamp, i) => {
        aPos.set([lamp.x, lamp.y, lamp.z, lamp.length], i * 4);
        aSweep.set([lamp.bearing, lamp.swing, lamp.period, lamp.phase], i * 4);
        aTilt.set([lamp.elevation, lamp.nod], i * 2);
    });
    // The beam: x across (-0.5..0.5), y along (0..1).
    const geometry = quadGeometry(count, {
        aLampPos: [aPos, 4], aLampSweep: [aSweep, 4], aLampTilt: [aTilt, 2],
    }, [-0.5, 0, 0.5, 1]);
    const { material, uOpacity } = additive('odyssey-neon-searchlights');
    const lampPos = attribute('aLampPos', 'vec4');
    const sweep = attribute('aLampSweep', 'vec4');
    const tilt = attribute('aLampTilt', 'vec2');
    const TAU = Math.PI * 2;
    // The same sines as resolveNeonSearchlight (odyssey-neon-clock.js).
    const bearing = sweep.x.add(sweep.y.mul(sin(N.uTime.mul(TAU).div(sweep.z).add(sweep.w))));
    const elevation = tilt.x.add(tilt.y.mul(sin(N.uTime.mul(TAU).div(sweep.z.mul(0.61)).add(sweep.w.mul(1.7)))));
    const dir = vec3(sin(bearing).mul(cos(elevation)), sin(elevation), cos(bearing).mul(cos(elevation)).negate());
    const along = positionGeometry.y;
    const onAxis = lampPos.xyz.add(dir.mul(along.mul(lampPos.w)));
    const side = normalize(cross(dir, onAxis.sub(N.camCity)));
    const width = along.mul(64.0).add(2.6);
    const point = onAxis.add(side.mul(positionGeometry.x.mul(width)));
    material.vertexNode = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(point, 1.0));
    const ign = neonIgnition(N, lampPos.xyz);
    const vGain = varying(
        ign.level.mul(N.seamReveal).mul(N.sky.dawn.mul(-0.85).add(1.0)).mul(N.uEnergy.mul(0.3).add(0.8)),
        'vLampGain',
    );
    material.outputNode = Fn(() => {
        const st = uv();
        const across = st.x.sub(0.5).mul(2.0);
        const profile = exp(across.mul(across).mul(-3.2));
        const run = smoothstep(0.0, 0.03, st.y).mul(float(1.0).sub(st.y)).mul(float(1.0).sub(st.y));
        // The beam is narrow at the lamp, so brighter there: its light is spread as it widens.
        const spread = float(1.0).div(st.y.mul(9.0).add(1.0)).add(0.12);
        return vec4(vec3(0.62, 0.8, 1.0).mul(profile).mul(run).mul(spread)
            .mul(0.34)
            .mul(vGain)
            .mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-searchlights';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    return mesh;
}

// ── The sun's shafts ─────────────────────────────────────────────────────────────

/** Each slice: how far toward the sun it stands (a share of the way), and its light. */
export const NEON_SHAFT_SLICES = Object.freeze([[0.24, 0.5], [0.4, 0.8], [0.58, 1.0], [0.78, 0.9]]);

/**
 * @param {object} N neon uniforms (camCity, sunPos, sky)
 */
export function createNeonSunShafts(N) {
    const slices = NEON_SHAFT_SLICES;
    const data = new Float32Array(slices.length * 4);
    slices.forEach(([share, gain], i) => data.set([share, gain, (i * 0.37) + 0.11, 0], i * 4));
    const geometry = quadGeometry(slices.length, { aShaft: [data, 4] });
    const { material, uOpacity } = additive('odyssey-neon-sun-shafts');
    const shaft = attribute('aShaft', 'vec4');
    const toSun = N.sunPos.sub(N.camCity);
    const centre = N.camCity.add(toSun.mul(shaft.x));
    const view = modelViewMatrix.mul(vec4(centre, 1.0));
    const half = length(toSun).mul(shaft.x).mul(0.62);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xy.add(positionGeometry.xy.mul(half)), view.z, 1.0));
    // Shafts need a gap for the sun to come through: none under a closed deck, most after rain.
    const vGain = varying(
        shaft.y.mul(N.sky.cover.mul(-1.15).add(1.0).max(0.0)).mul(N.seamReveal).mul(N.sunVisible ?? float(1.0)),
        'vShaftGain',
    );
    const vSeed = varying(shaft.z, 'vShaftSeed');
    material.outputNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const r = length(q).toVar();
        const ray = q.div(max(r, 1e-3));
        // Rays about the sun's place: two scales of noise round the fan, drifting slowly.
        const n1 = latticeNoise3(vec3(ray.x.mul(1.5).add(vSeed.mul(9.0)), ray.y.mul(1.5), N.uTime.mul(0.021).add(vSeed.mul(5.0))));
        const n2 = latticeNoise3(vec3(ray.x.mul(3.4), ray.y.mul(3.4).add(vSeed.mul(4.0)), N.uTime.mul(0.034)));
        // Broad and soft: fine rays read as scratches on the lens.
        const rays = smoothstep(0.36, 0.74, n1.mul(0.72).add(n2.mul(0.28)));
        // Strongest a little way out from the disc, gone at the slice's edge; mostly upward (the
        // street lies below the sun).
        const reach = smoothstep(0.03, 0.2, r).mul(exp(r.mul(-2.6))).mul(float(1.0).sub(smoothstep(0.72, 1.0, r)));
        const upward = smoothstep(-0.5, 0.25, ray.y).mul(0.75).add(0.25);
        return vec4(N.sky.sunGlow.mul(rays).mul(reach).mul(upward).mul(0.2)
            .mul(vGain)
            .mul(uOpacity), 0.0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-sun-shafts';
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    return mesh;
}

// ── The hologram ─────────────────────────────────────────────────────────────────

/**
 * THE END OF THE LINE (2026-11-25, the deep chapters audit C5: the journey's last orb was a dot in
 * the middle of the street with nothing to mark it). Two rings of light stand upright round the end of
 * the rail, facing down the boulevard, their dashes running round them in turn, and a faint pillar of
 * light rises from the street through them into the sky: the station the line ends at. Pure added
 * light like the rest of the city's air; it lights with the street (`neonIgnition`) and fades through
 * the 7->8 carry. On every tier (the Low city keeps its rail's end too).
 */
export const NEON_TERMINUS = Object.freeze({
    /** The rings' radii (u, about the end of the rail) and their band's width (u). */
    rings: Object.freeze([5.4, 7.0]),
    band: 0.34,
    /** Dashes round each ring, and how fast they run (turns a second, opposite ways). */
    dashes: Object.freeze([48, 36]),
    speed: Object.freeze([0.05, -0.035]),
    /** The pillar: radius (u), height over the street (u), brightness. */
    pillar: 1.4,
    height: 240,
    pillarGain: 0.16,
});

/**
 * @param {object} N neon uniforms
 * @param {{ x: number, y: number, z: number }} seat the end of the rail, in the corridor's frame
 * @returns {THREE.Group}
 */
export function createNeonTerminus(N, seat) {
    const T = NEON_TERMINUS;
    const group = new THREE.Group();
    group.name = 'neon-terminus';
    group.position.set(seat.x, seat.y, seat.z);
    const ign = neonIgnition(N, vec3(seat.x, seat.y, seat.z));
    const live = ign.level.mul(N.seamReveal);
    const breath = sin(N.uTime.mul(1.1)).mul(0.1).add(0.9);
    const colours = [vec3(1.0, 0.3, 0.72), vec3(0.15, 0.85, 1.0)];
    T.rings.forEach((radius, i) => {
        const ring = additive(`odyssey-neon-terminus-ring-${i}`);
        ring.material.outputNode = Fn(() => {
            const st = uv();
            const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
            const run = st.x.sub(N.uTime.mul(T.speed[i]));
            const dash = step(0.32, fract(run.mul(T.dashes[i])));
            const bead = exp(abs(fract(run).sub(0.5)).mul(-26.0));
            const light = colours[i].mul(across.mul(across).mul(dash.mul(0.5).add(0.5)).mul(0.9))
                .add(vec3(1.0, 0.92, 0.85).mul(bead.mul(across).mul(1.4)));
            return vec4(light.mul(live).mul(breath).mul(ring.uOpacity), 0.0);
        })();
        const geometry = new THREE.CylinderGeometry(radius, radius, T.band, 128, 1, true);
        const mesh = new THREE.Mesh(geometry, ring.material);
        mesh.name = `neon-terminus-ring-${i}`;
        // Its axis down the boulevard (the corridor's z): the rings face the eye coming along it.
        mesh.rotation.x = Math.PI / 2;
        mesh.renderOrder = 15;
        group.add(mesh);
    });
    // The pillar, from the street up through the rings.
    const pillar = additive('odyssey-neon-terminus-pillar');
    const pcPillar = neonCityPos(N, 'vTerminusPillarPos');
    const nPillar = varying(normalGeometry, 'vTerminusPillarNormal');
    pillar.material.outputNode = Fn(() => {
        // (Clamped: under MSAA the interpolated uv strays past 0..1 on thin geometry, and a power of
        // the negative remainder is a NaN the bloom spreads over the frame; gotcha #105.)
        const rise = clamp(uv().y, 0.0, 1.0);
        const fade = float(1.0).sub(rise).pow(1.6).mul(smoothstep(0.0, 0.04, rise));
        const lines = step(0.5, fract(rise.mul(60.0).sub(N.uTime.mul(0.5)))).mul(0.35).add(0.65);
        // Soft across its width (a beam, not a slab): brightest on the side facing the eye.
        const view = normalize(N.camCity.sub(pcPillar));
        const core = clamp(dot(normalize(nPillar), view), 0.0, 1.0);
        return vec4(vec3(0.55, 0.9, 1.0).mul(fade).mul(lines).mul(core.mul(core).mul(core))
            .mul(T.pillarGain)
            .mul(live)
            .mul(pillar.uOpacity), 0.0);
    })();
    const drop = seat.y - STREET_Y;
    const pillarMesh = new THREE.Mesh(new THREE.CylinderGeometry(T.pillar, T.pillar, T.height, 24, 1, true), pillar.material);
    pillarMesh.name = 'neon-terminus-pillar';
    pillarMesh.position.y = (T.height * 0.5) - drop;
    pillarMesh.renderOrder = 14;
    group.add(pillarMesh);
    return group;
}

export const NEON_HOLOGRAM = Object.freeze({
    side: 1, bank: 0, z: -96, radius: 9.5, hover: 15, maxRoof: 6,
});

/**
 * Seat the globe over a roof to the right of the boulevard: the dealt tower of its bank nearest its
 * place whose roof is low enough to leave the globe in the eye's band.
 * @param {object[]} towers dealCityTowers()
 * @returns {{ x: number, y: number, z: number, roofY: number, radius: number }}
 */
export function planNeonHologram(towers) {
    const H = NEON_HOLOGRAM;
    let best = null;
    towers.forEach((tower) => {
        if (tower.side !== H.side || tower.bank !== H.bank) return;
        const roof = tower.y + (tower.height * 0.5);
        if (roof > H.maxRoof) return;
        if (!best || Math.abs(tower.z - H.z) < Math.abs(best.z - H.z)) best = tower;
    });
    const host = best ?? {
        x: H.side * 66, y: -30, z: H.z, height: 60,
    };
    const roofY = host.y + (host.height * 0.5);
    return {
        x: host.x, y: roofY + H.hover, z: host.z, roofY, radius: H.radius,
    };
}

/**
 * @param {object} N neon uniforms
 * @param {ReturnType<typeof planNeonHologram>} seat
 * @returns {THREE.Group}
 */
export function createNeonHologram(N, seat) {
    const group = new THREE.Group();
    group.name = 'neon-hologram';
    group.position.set(seat.x, seat.y, seat.z);
    const ign = neonIgnition(N, vec3(seat.x, seat.y, seat.z));
    const live = ign.level.mul(N.seamReveal).mul(N.sky.dawn.mul(-0.55).add(1.0));
    // A slow breath and a faint drop-out now and then: a projection, not a lamp.
    const breath = sin(N.uTime.mul(0.9)).mul(0.08).add(0.92)
        .mul(float(1.0).sub(smoothstep(0.985, 1.0, sin(N.uTime.mul(0.37)).mul(0.5).add(0.5)).mul(0.35)));

    // The globe.
    const globe = additive('odyssey-neon-hologram-globe');
    const pcGlobe = neonCityPos(N, 'vHoloPos');
    const nGlobe = varying(normalGeometry, 'vHoloNormal');
    globe.material.outputNode = Fn(() => {
        const n = normalize(nGlobe).toVar();
        const st = uv();
        const view = normalize(N.camCity.sub(pcGlobe));
        const facing = clamp(dot(n, view), 0.0, 1.0);
        const rim = float(1.0).sub(facing);
        // Land: a coarse noise over the turning sphere, drawn as rows of dots; sea: faint grid.
        const turn = N.uTime.mul(0.035);
        const land = smoothstep(0.52, 0.56, latticeNoise3(vec3(
            n.x.mul(cos(turn)).add(n.z.mul(sin(turn))).mul(2.1).add(7.0),
            n.y.mul(2.6).add(3.0),
            n.z.mul(cos(turn)).sub(n.x.mul(sin(turn))).mul(2.1).add(5.0),
        )));
        const rows = smoothstep(0.25, 0.4, abs(fract(st.y.mul(46.0)).sub(0.5)));
        const grid = max(
            float(1.0).sub(smoothstep(0.0, 0.03, abs(fract(st.x.mul(12.0).add(turn.mul(1.9))).sub(0.5)))),
            float(1.0).sub(smoothstep(0.0, 0.04, abs(fract(st.y.mul(8.0)).sub(0.5)))),
        );
        // A scan line climbing the globe.
        const scan = exp(abs(fract(st.y.sub(N.uTime.mul(0.09))).sub(0.5)).mul(-22.0));
        const cyan = vec3(0.1, 0.85, 1.0);
        const rose = vec3(1.0, 0.25, 0.65);
        // (2026-11-25, the deep chapters audit C5: it read as a glass ball, a decoy in a world where
        // glass spheres are the orbs: a bright rose rim all round its edge and a lit fill. It is a
        // projection now: its lines and its land's dots, a faint rim, the scan lines of a picture
        // drawn in light, and nothing between them.)
        const interlace = step(0.5, fract(st.y.mul(140.0).add(N.uTime.mul(1.3)))).mul(0.45).add(0.55);
        const light = cyan.mul(land.mul(rows).mul(0.75).add(grid.mul(0.42)).add(scan.mul(0.35)))
            .mul(interlace)
            .add(rose.mul(rim.mul(rim).mul(rim).mul(0.22)));
        return vec4(light.mul(facing.mul(0.35).add(0.65)).mul(0.85).mul(live).mul(breath)
            .mul(globe.uOpacity), 0.0);
    })();
    globe.material.side = THREE.FrontSide;
    const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(seat.radius, 40, 24), globe.material);
    globeMesh.name = 'neon-hologram-globe';
    globeMesh.renderOrder = 15;
    group.add(globeMesh);

    // The ring: a thin band tilted round the globe, a bright bead running it.
    const ring = additive('odyssey-neon-hologram-ring');
    ring.material.outputNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const bead = exp(abs(fract(st.x.sub(N.uTime.mul(0.05))).sub(0.5)).mul(-38.0));
        const dash = step(0.35, fract(st.x.mul(64.0)));
        const light = vec3(1.0, 0.3, 0.7).mul(across.mul(across).mul(dash).mul(0.5))
            .add(vec3(1.0, 0.9, 0.8).mul(bead.mul(across).mul(1.6)));
        return vec4(light.mul(0.6).mul(live).mul(breath).mul(ring.uOpacity), 0.0);
    })();
    const ringGeometry = new THREE.CylinderGeometry(seat.radius * 1.55, seat.radius * 1.55, seat.radius * 0.09, 64, 1, true);
    const ringMesh = new THREE.Mesh(ringGeometry, ring.material);
    ringMesh.name = 'neon-hologram-ring';
    ringMesh.rotation.set(0.38, 0, 0.3);
    ringMesh.renderOrder = 15;
    group.add(ringMesh);

    // The projector's cone, from the roof up to the globe.
    const cone = additive('odyssey-neon-hologram-cone');
    cone.material.outputNode = Fn(() => {
        const st = uv();
        const lines = step(0.5, fract(st.y.mul(26.0).sub(N.uTime.mul(0.6))));
        const fade = st.y.mul(float(1.0).sub(st.y)).mul(4.0);
        return vec4(vec3(0.1, 0.8, 1.0).mul(lines.mul(0.5).add(0.5)).mul(fade).mul(0.035)
            .mul(live)
            .mul(breath)
            .mul(cone.uOpacity), 0.0);
    })();
    const drop = seat.y - seat.roofY;
    const coneGeometry = new THREE.CylinderGeometry(seat.radius * 0.8, 1.2, drop, 24, 1, true);
    const coneMesh = new THREE.Mesh(coneGeometry, cone.material);
    coneMesh.name = 'neon-hologram-cone';
    coneMesh.position.y = -drop * 0.5;
    coneMesh.renderOrder = 14;
    group.add(coneMesh);
    return group;
}
