/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE ELEVATED LINE (2026-11-17 masterpiece pass).
 *
 * A twin line runs the boulevard between the eye and the street: two filaments of lamps in the
 * air over the kerb lanes and under the rail, from behind the eye to a terminus at the spire's
 * foot. A train comes down one line toward the sun and, less often, up the
 * other toward the eye (odyssey-neon-clock.js `resolveNeonTrain`: closed form in the clock), its
 * windows lit, a white lamp on its nose and red on its tail, a ribbon of light drawn out behind
 * it along the beam.
 *
 * Heights are threaded: over the lantern strings (they hang at y -46..-34) and the two low
 * skybridges, level with the roof of the high one, 10 u under the rail.
 *
 * Three draws: the structure (instanced boxes, static), the cars (instanced boxes; each line's
 * place along the boulevard is one uniform the chapter sets), the light ribbons.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    exp,
    float,
    floor,
    fract,
    max,
    mix,
    normalGeometry,
    positionGeometry,
    positionLocal,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { STREET_Y } from './odyssey-neon-city-plan.js';
import { NEON_TRAIN, NEON_TRAIN_LINES, resolveNeonTrain } from './odyssey-neon-clock.js';
import {
    neonAtmosphere, neonCityPos, neonGlow, neonIgnition,
} from './odyssey-neon-light.tsl.js';
import { neonSkyLite } from './odyssey-neon-sky.tsl.js';
import { hash21 } from './odyssey-tsl-noise.js';

/** The structure's measures (corridor units). */
export const NEON_TRAIN_STRUCTURE = Object.freeze({
    beamWidth: 0.24,
    beamHeight: 0.2,
    /** Where a parked (absent) train waits: under the carpet, out of every view. */
    parkedY: -900,
});

/**
 * @param {object} N neon uniforms
 * @returns {{ group: THREE.Group, update: (time: number) => void, solids: THREE.Object3D[] }}
 */
export function createNeonTrain(N) {
    const T = NEON_TRAIN;
    const SS = NEON_TRAIN_STRUCTURE;
    const lines = NEON_TRAIN_LINES;
    const group = new THREE.Group();
    group.name = 'neon-elevated-line';
    const flat = (node, name) => varying(node, name).setInterpolation('flat', 'either');

    // ── The structure: beams, T-pylons, the terminus ──
    const parts = [];
    const beamY = lines[0].y - (T.carHeight * 0.5) - (SS.beamHeight * 0.5) - 0.1;
    const length = T.zNear - T.zFar;
    lines.forEach((line) => {
        parts.push({
            x: line.x, y: beamY, z: (T.zNear + T.zFar) * 0.5, w: SS.beamWidth, h: SS.beamHeight, d: length, kind: 0,
        });
    });
    // (No pylons: a first build stood T-pylons on the median, and their arms laid a black ladder
    // across the boulevard under the rail and the orbs. The line is a filament of lamps the trains
    // ride, as the city's sky traffic rides nothing at all.)
    // The terminus at the spire's foot: a hall the lines run into, its mouth lit.
    const reach = Math.abs(lines[0].x) + 2.4;
    parts.push({
        x: 0, y: lines[0].y + 1.2, z: T.zFar - 9, w: reach * 2 + 7, h: T.carHeight + 6.4, d: 18, kind: 2,
    });
    const structureGeometry = new THREE.BoxGeometry(1, 1, 1);
    const structureLook = new Float32Array(parts.length * 4);
    const pcStructure = neonCityPos(N, 'vTrainStructurePos');
    const aPart = flat(attribute('aTrainPart', 'vec4'), 'vTrainPart');
    const nStructure = flat(normalGeometry, 'vTrainStructureN');
    const structureMaterial = new THREE.MeshBasicNodeMaterial();
    structureMaterial.name = 'odyssey-neon-train-structure';
    structureMaterial.fog = false;
    structureMaterial.userData.emitsBloom = true;
    structureMaterial.colorNode = Fn(() => {
        const pc = pcStructure.toVar();
        const n = nStructure;
        const kind = aPart.x;
        const ign = neonIgnition(N, pc);
        const hAbove = max(pc.y.sub(STREET_Y), 0.0);
        const steel = vec3(0.034, 0.036, 0.046);
        const sky = neonSkyLite(N.sky, vec3(n.x, n.y.add(0.5), n.z).normalize()).mul(0.5);
        const bounce = neonGlow(N, pc, 1).mul(ign.level).mul(exp(hAbove.mul(-1 / 30))).mul(0.5);
        // A line of small lamps under each beam: the line reads as a line of light from above.
        const isBeam = step(kind, 0.5);
        const lampPhase = abs(fract(pc.z.div(7.0)).sub(0.5));
        const lamps = float(1.0).sub(smoothstep(0.05, 0.12, lampPhase)).mul(isBeam);
        const lampCol = mix(vec3(0.1, 0.8, 1.0), vec3(1.0, 0.3, 0.6), step(0.0, pc.x)).mul(0.9);
        // The terminus' mouth: warm light in the hall, seen from up the boulevard.
        const isHall = step(1.5, kind);
        const mouth = isHall.mul(step(0.5, n.z)).mul(smoothstep(0.08, 0.14, uv().y)).mul(float(1.0).sub(smoothstep(0.7, 0.76, uv().y)))
            .mul(step(0.06, uv().x))
            .mul(step(uv().x, 0.94));
        const lights = lampCol.mul(lamps).add(vec3(1.0, 0.72, 0.42).mul(mouth).mul(0.55)).mul(ign.level).mul(N.seamReveal);
        return neonAtmosphere(N, steel.mul(sky.add(bounce)).add(lights), pc, vec3(0.0, 0.0, 0.0));
    })();
    const structure = new THREE.InstancedMesh(structureGeometry, structureMaterial, parts.length);
    structure.name = 'neon-train-structure';
    structure.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    parts.forEach((part, i) => {
        structure.setMatrixAt(i, m.compose(p.set(part.x, part.y, part.z), q, s.set(part.w, part.h, part.d)));
        structureLook.set([part.kind, 0, 0, 0], i * 4);
    });
    structure.instanceMatrix.needsUpdate = true;
    structureGeometry.setAttribute('aTrainPart', new THREE.InstancedBufferAttribute(structureLook, 4));
    structure.computeBoundingSphere();
    group.add(structure);

    // ── The cars ──
    const carCount = lines.reduce((sum, line) => sum + line.cars, 0);
    const carGeometry = new THREE.BoxGeometry(1, 1, 1);
    const carLook = new Float32Array(carCount * 4); // line, car index, cars in the train, seed
    // Each line's nose along the boulevard and its height (parked below the world between trains).
    const uNose = lines.map(() => uniform(new THREE.Vector2(0, SS.parkedY)));
    const cars = new THREE.InstancedMesh(carGeometry, null, carCount);
    cars.name = 'neon-train-cars';
    cars.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    cars.frustumCulled = false;
    let slot = 0;
    lines.forEach((line, li) => {
        for (let c = 0; c < line.cars; c += 1) {
            // Behind the nose by the cars ahead of it: the nose leads along the line's direction.
            const back = -line.dir * ((c * (T.carLength + T.carGap)) + (T.carLength * 0.5));
            cars.setMatrixAt(slot, m.compose(p.set(line.x, 0, back), q, s.set(T.carWidth, T.carHeight, T.carLength)));
            carLook.set([li, c, line.cars, (li * 7.3) + (c * 1.9)], slot * 4);
            slot += 1;
        }
    });
    cars.instanceMatrix.needsUpdate = true;
    carGeometry.setAttribute('aTrainCar', new THREE.InstancedBufferAttribute(carLook, 4));
    const aCar = flat(attribute('aTrainCar', 'vec4'), 'vTrainCar');
    const nCar = flat(normalGeometry, 'vTrainCarN');
    const noseOf = (lineIndex) => (lines.length > 1 ? mix(uNose[0], uNose[1], step(0.5, lineIndex)) : uNose[0]);
    const carMaterial = new THREE.MeshBasicNodeMaterial();
    carMaterial.name = 'odyssey-neon-train-cars';
    carMaterial.fog = false;
    carMaterial.userData.emitsBloom = true;
    const carNose = noseOf(attribute('aTrainCar', 'vec4').x);
    carMaterial.positionNode = positionLocal.add(vec3(0.0, carNose.y, carNose.x));
    const pcCar = neonCityPos(N, 'vTrainCarPos');
    carMaterial.colorNode = Fn(() => {
        const pc = pcCar.toVar();
        const n = nCar;
        const st = uv();
        const dirSign = mix(float(lines[0].dir), float(lines[lines.length - 1].dir), step(0.5, aCar.x));
        const isSide = step(0.5, abs(n.x));
        const isRoof = step(0.5, n.y);
        const isEnd = step(0.5, abs(n.z));
        const ign = neonIgnition(N, pc);
        // A band of lit windows down each side, a door's dark pillar between them.
        const along = st.x.mul(T.carLength);
        const pillar = step(0.16, fract(along.div(2.5)));
        const bandY = smoothstep(0.42, 0.47, st.y).mul(float(1.0).sub(smoothstep(0.8, 0.85, st.y)));
        const rider = hash21(vec2(floor(along.div(2.5)), aCar.w)).mul(0.5).add(0.5);
        const windows = vec3(1.0, 0.86, 0.62).mul(bandY).mul(pillar).mul(rider)
            .mul(isSide)
            .mul(0.85);
        // A stripe of the line's colour under the windows.
        const stripeCol = mix(vec3(1.0, 0.25, 0.6), vec3(0.1, 0.85, 1.0), step(0.5, aCar.x));
        const stripe = smoothstep(0.26, 0.29, st.y).mul(float(1.0).sub(smoothstep(0.33, 0.36, st.y))).mul(isSide);
        // The roof: a dark shell with a skylight strip.
        // The roof: glazed down its middle, the cabin's light coming up through it (the eye looks
        // down on the trains: a dark roof made them black slugs).
        const skylight = float(1.0).sub(smoothstep(0.2, 0.26, abs(st.x.sub(0.5)))).mul(isRoof)
            .mul(step(0.1, fract(st.y.mul(6.0))))
            .mul(0.62);
        // Lamps: white on the leading end of the first car, red on the trailing end of the last.
        const leading = step(0.5, n.z.mul(dirSign));
        const first = step(aCar.y, 0.5);
        const last = step(aCar.z.sub(1.5), aCar.y);
        const lampSpot = exp(vec2(abs(st.x.sub(0.5)).sub(0.28), st.y.sub(0.3)).mul(vec2(9.0, 7.0)).lengthSq().negate());
        const head = vec3(1.0, 0.95, 0.85).mul(lampSpot).mul(isEnd).mul(leading)
            .mul(first)
            .mul(2.2);
        const tail = vec3(1.0, 0.07, 0.04).mul(lampSpot).mul(isEnd).mul(float(1.0).sub(leading))
            .mul(last)
            .mul(1.6);
        const shell = vec3(0.05, 0.055, 0.07);
        const sky = neonSkyLite(N.sky, vec3(n.x, n.y.add(0.5), n.z).normalize()).mul(0.7);
        const lights = windows.add(stripeCol.mul(stripe).mul(0.8)).add(vec3(1.0, 0.9, 0.75).mul(skylight)).add(head).add(tail)
            .mul(ign.level.mul(0.4).add(0.6))
            .mul(N.seamReveal);
        return neonAtmosphere(N, shell.mul(sky).add(lights), pc, vec3(0.0, 0.0, 0.0));
    })();
    cars.material = carMaterial;
    group.add(cars);

    // ── The ribbon of light a train draws out behind it ──
    const ribbonGeometry = new THREE.InstancedBufferGeometry();
    ribbonGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    ribbonGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1], 3));
    ribbonGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    const ribbonLook = new Float32Array(lines.length * 4);
    lines.forEach((line, li) => {
        ribbonLook.set([li, line.x, -line.dir, line.cars * (T.carLength + T.carGap)], li * 4);
    });
    ribbonGeometry.setAttribute('aRibbon', new THREE.InstancedBufferAttribute(ribbonLook, 4));
    ribbonGeometry.instanceCount = lines.length;
    const aRibbon = attribute('aRibbon', 'vec4');
    const ribbonNose = noseOf(aRibbon.x);
    const uOpacity = uniform(1);
    const ribbonMaterial = new THREE.MeshBasicNodeMaterial();
    ribbonMaterial.name = 'odyssey-neon-train-ribbon';
    ribbonMaterial.transparent = true;
    ribbonMaterial.depthWrite = false;
    ribbonMaterial.fog = false;
    ribbonMaterial.side = THREE.DoubleSide;
    ribbonMaterial.forceSinglePass = true;
    ribbonMaterial.blending = THREE.AdditiveBlending;
    ribbonMaterial.premultipliedAlpha = true;
    ribbonMaterial.uniforms = { uOpacity };
    // From the train's tail back along the line: 0.9 of the train's length again.
    const ribbonLength = aRibbon.w.mul(0.9);
    ribbonMaterial.positionNode = vec3(
        aRibbon.y.add(positionGeometry.x.mul(T.carWidth * 0.8)),
        ribbonNose.y.add(T.carHeight * 0.52),
        ribbonNose.x.add(aRibbon.z.mul(aRibbon.w.add(positionGeometry.z.mul(ribbonLength)))),
    );
    const ribbonCol = flat(mix(vec3(1.0, 0.3, 0.55), vec3(0.2, 0.8, 1.0), step(0.5, aRibbon.x)), 'vRibbonCol');
    ribbonMaterial.outputNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.x.sub(0.5)).mul(2.0)).max(0.0);
        const fade = float(1.0).sub(st.y);
        return vec4(ribbonCol.mul(across.mul(across)).mul(fade.mul(fade)).mul(0.22).mul(uOpacity)
            .mul(N.seamReveal), 0.0);
    })();
    const ribbons = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
    ribbons.name = 'neon-train-ribbons';
    ribbons.frustumCulled = false;
    ribbons.renderOrder = 20;
    group.add(ribbons);

    return {
        group,
        solids: [structure, cars],
        /** Seat each line's train for the chapter clock. */
        update(time) {
            lines.forEach((line, li) => {
                const train = resolveNeonTrain(line, time);
                if (train) uNose[li].value.set(train.z, line.y);
                else uNose[li].value.set(0, SS.parkedY);
            });
        },
    };
}
