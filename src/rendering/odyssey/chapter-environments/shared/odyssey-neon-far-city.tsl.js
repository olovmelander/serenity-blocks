/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview THE CITY BEYOND THE CITY, drawn (2026-11-17 masterpiece pass).
 *
 *   The carpet  one great plane under everything, a little below the street: the far districts'
 *               streets as lines of lamps (amber, here and there a rose or cyan one), block after
 *               block out into the haze. Sub-pixel lamps keep their mean light, so the carpet
 *               glitters near and glows far, and the air (odyssey-neon-light) takes it at the
 *               horizon, where it meets the sky's own colour.
 *   The towers  one instanced draw of the far districts' towers (odyssey-neon-far-plan.js): dark
 *               shapes with a few lit floors and, on the tall ones, a crown line, standing in the
 *               same air, so they fade in layers.
 *
 * Both are seen from the journey's end (the eye rises over the roofs) and through the gaps
 * between the dealt city's towers; neither is built on the Low tiers (they do not rise).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    float,
    floor,
    fract,
    fwidth,
    max,
    min,
    mix,
    normalGeometry,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { STREET_Y } from './odyssey-neon-city-plan.js';
import { neonAir, neonCityPos } from './odyssey-neon-light.tsl.js';
import { hash21 } from './odyssey-tsl-noise.js';
import { latticeNoise3 } from './odyssey-lattice-noise.js';

/** The carpet's blocks (corridor units): the dealt city's own rank spacing, two ranks a block. */
export const NEON_CARPET = Object.freeze({
    size: 11000, blockX: 46, blockZ: 53.1, lamp: 9.5, drop: 1.6,
});

/**
 * The far ground.
 * @param {object} N neon uniforms
 * @returns {THREE.Mesh}
 */
export function createNeonCarpet(N) {
    const C = NEON_CARPET;
    const pcVarying = neonCityPos(N, 'vCarpetPos');
    const colorNode = Fn(() => {
        const pc = pcVarying.toVar();
        const g = vec2(pc.x.div(C.blockX), pc.z.div(C.blockZ)).toVar();
        const f = fract(g).toVar();
        const fw = fwidth(g).max(vec2(1e-4, 1e-4)).toVar();
        const lod = smoothstep(0.03, 0.22, max(fw.x, fw.y)).toVar();
        // Distance to the nearest street of each direction, in corridor units.
        const toStreetX = min(f.x, float(1.0).sub(f.x)).mul(C.blockX).toVar();
        const toStreetZ = min(f.y, float(1.0).sub(f.y)).mul(C.blockZ).toVar();
        const wide = float(2.4);
        const aa = max(fw.x.mul(C.blockX), fw.y.mul(C.blockZ)).add(0.25).toVar();
        const onX = float(1.0).sub(smoothstep(wide, wide.add(aa), toStreetX)).toVar();
        const onZ = float(1.0).sub(smoothstep(wide, wide.add(aa), toStreetZ)).toVar();
        // Lamps down each street, every `lamp` units: a dot near, their mean light far.
        const lampAlongZ = abs(fract(pc.z.div(C.lamp)).sub(0.5)).mul(2.0);
        const lampAlongX = abs(fract(pc.x.div(C.lamp)).sub(0.5)).mul(2.0);
        const dotZ = mix(smoothstep(0.62, 0.9, lampAlongZ), float(0.2), lod);
        const dotX = mix(smoothstep(0.62, 0.9, lampAlongX), float(0.2), lod);
        // Each street has its own lamps: most amber, some rose, some cyan, some dark.
        const streetIdX = floor(g.x.add(0.5));
        const streetIdZ = floor(g.y.add(0.5));
        const hx = hash21(vec2(streetIdX, 3.7)).toVar();
        const hz = hash21(vec2(streetIdZ, 9.1)).toVar();
        const tint = (h) => mix(
            mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.16, 0.5), step(0.62, h)),
            vec3(0.1, 0.75, 1.0),
            step(0.84, h),
        );
        // Districts: some are bright, some nearly dark.
        const district = latticeNoise3(vec3(pc.x.div(420.0).add(31.7), 2.5, pc.z.div(420.0).add(11.3)));
        const life = smoothstep(0.25, 0.75, district).mul(0.85).add(0.15).toVar();
        const lamps = tint(hx).mul(onX.mul(dotZ).mul(step(0.18, hx)))
            .add(tint(hz).mul(onZ.mul(dotX).mul(step(0.18, hz))))
            .mul(life)
            .mul(1.25);
        // The asphalt between the lamps takes their glow; the blocks are roofs: dark, a skylight
        // or a lit yard here and there.
        const roofCell = floor(vec2(pc.x.div(11.5), pc.z.div(13.3)));
        const roofRnd = hash21(roofCell.add(vec2(17.0, 5.0)));
        const yard = step(0.955, roofRnd).mul(float(1.0).sub(max(onX, onZ))).mul(mix(float(1.0), float(0.045), lod));
        const yardCol = mix(vec3(1.0, 0.62, 0.3), vec3(0.4, 0.75, 1.0), step(0.985, roofRnd)).mul(0.5);
        const street = max(onX, onZ);
        const ground = mix(vec3(0.006, 0.005, 0.012), vec3(0.03, 0.016, 0.03), street).mul(life.mul(0.6).add(0.4));
        const lights = lamps.add(yardCol.mul(yard).mul(life)).mul(N.seamReveal).toVar();
        const air = neonAir(N, pc, vec3(0.0, 0.0, 0.0));
        // The lamps reach a little further through the air than the ground does.
        return mix(ground.add(lights), air.colour, air.amount)
            .add(lights.mul(air.amount).mul(float(1.0).sub(air.amount)).mul(0.9));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-carpet';
    material.colorNode = colorNode;
    material.fog = false;
    material.side = THREE.FrontSide;
    const geometry = new THREE.PlaneGeometry(C.size, C.size, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'neon-far-carpet';
    mesh.position.set(0, STREET_Y - C.drop, -200);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * The far districts' towers: one instanced draw.
 * @param {object} N neon uniforms
 * @param {ReturnType<import('./odyssey-neon-far-plan.js').dealFarCity>} towers
 * @returns {THREE.InstancedMesh}
 */
export function createNeonFarTowers(N, towers) {
    const count = Math.max(1, towers.length);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const looks = new Float32Array(count * 4); // seed, lit, hue, crown
    const dims = new Float32Array(count * 3);
    const flat = (node, name) => varying(node, name).setInterpolation('flat', 'either');
    const aLook = flat(attribute('aFarLook', 'vec4'), 'vFarLook');
    const aDims = flat(attribute('aFarDims', 'vec3'), 'vFarDims');
    const n = flat(normalGeometry, 'vFarNormal');
    const pcVarying = neonCityPos(N, 'vFarPos');

    const colorNode = Fn(() => {
        const pc = pcVarying.toVar();
        const seed = aLook.x;
        const isRoof = step(0.5, abs(n.y));
        const faceW = mix(aDims.x, aDims.z, step(0.5, abs(n.x)));
        const st = uv();
        const g = vec2(st.x.mul(faceW).div(3.4), st.y.mul(aDims.y).div(4.2)).toVar();
        const cell = floor(g);
        const f = fract(g);
        const fw = fwidth(g).max(vec2(1e-4, 1e-4)).toVar();
        const lod = smoothstep(0.25, 0.8, max(fw.x, fw.y)).toVar();
        const pane = mix(
            smoothstep(0.16, fw.x.add(0.16), f.x).mul(float(1.0).sub(smoothstep(fw.x.negate().add(0.84), 0.84, f.x)))
                .mul(smoothstep(0.22, fw.y.add(0.22), f.y))
                .mul(float(1.0).sub(smoothstep(fw.y.negate().add(0.86), 0.86, f.y))),
            float(0.42),
            lod,
        );
        // Whole floors lit in runs, as the near towers are.
        const floorRnd = hash21(vec2(cell.y, seed.mul(0.731)));
        const runRnd = hash21(vec2(floor(cell.x.div(3.0)), cell.y.add(seed.mul(7.0)).add(n.x.mul(3.0)).add(n.z.mul(5.0))));
        const lit = step(float(1.0).sub(aLook.y.mul(2.2)), floorRnd).mul(step(0.45, runRnd))
            .mul(float(1.0).sub(isRoof));
        const warm = step(fract(seed.mul(0.37)), 0.62);
        const wcol = mix(vec3(0.5, 0.78, 1.0).mul(0.5), vec3(1.0, 0.58, 0.26).mul(0.6), warm);
        // A crown line on the tall ones: rose or cyan.
        const crownDist = float(1.0).sub(st.y).mul(aDims.y);
        const crownCol = mix(vec3(1.0, 0.16, 0.6), vec3(0.05, 0.8, 1.0), step(0.5, aLook.z));
        const crown = float(1.0).sub(smoothstep(0.5, 1.6, crownDist)).mul(aLook.w).mul(float(1.0).sub(isRoof));
        const lights = wcol.mul(lit).mul(pane).add(crownCol.mul(crown).mul(0.9)).mul(N.seamReveal)
            .toVar();
        // The walls take a little of the sky's light on the side that faces the sun.
        const toSun = max(n.dot(N.sky.sunDir), 0.0);
        const body = vec3(0.007, 0.006, 0.014).add(N.sky.hazeSun.mul(toSun.mul(0.06)))
            .add(N.sky.haze.mul(isRoof.mul(0.5)));
        const air = neonAir(N, pc, vec3(0.0, 0.0, 0.0));
        return mix(body.add(lights), air.colour, air.amount)
            .add(lights.mul(air.amount).mul(float(1.0).sub(air.amount)).mul(0.55));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'odyssey-neon-far-towers';
    material.colorNode = colorNode;
    material.fog = false;
    const mesh = new THREE.InstancedMesh(box, material, count);
    mesh.name = 'neon-far-towers';
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    towers.forEach((tower, i) => {
        p.set(tower.x, tower.y, tower.z);
        s.set(tower.width, tower.height, tower.depth);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        looks.set([tower.seed, tower.lit, tower.hue, tower.crown], i * 4);
        dims.set([tower.width, tower.height, tower.depth], i * 3);
    });
    mesh.count = towers.length;
    mesh.instanceMatrix.needsUpdate = true;
    box.setAttribute('aFarLook', new THREE.InstancedBufferAttribute(looks, 4));
    box.setAttribute('aFarDims', new THREE.InstancedBufferAttribute(dims, 3));
    mesh.computeBoundingSphere();
    return mesh;
}
