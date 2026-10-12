/** Three growing erosion pinnacles, with the same geological record as the land. */
import * as THREE from 'three/webgpu';
import {
    Fn, atan, attribute, cameraProjectionMatrix, cameraViewMatrix, cos,
    float, fract, max, mix, positionGeometry, sin, smoothstep, step,
    uv, varying, vec3, vec4,
} from 'three/tsl';
import {
    createFxGeometry, createFxMaterial, createFxMesh, samplePath,
} from './painted-ages-air.js';
import { paHaze, paKeepOut, strataAt } from './painted-ages-tsl.js';

export const HOODOO_SLOTS = 3;
export const HOODOO_STRIDE = 12;
const HOODOO_HEIGHTS = Object.freeze([18, 28, 40]);

export function createHoodoos({
    u, tier = {}, bake, recordTexture,
}) {
    const radial = tier.hoodooSegments || 20;
    const rows = 48;
    const positions = new Float32Array((rows + 1) * (radial + 1) * 3);
    const indices = [];
    for (let row = 0; row <= rows; row++) {
        const h = row / rows;
        for (let segment = 0; segment <= radial; segment++) {
            const theta = (segment / radial) * Math.PI * 2;
            const o = (row * (radial + 1) + segment) * 3;
            positions[o] = Math.cos(theta); positions[o + 1] = h; positions[o + 2] = Math.sin(theta);
            if (row < rows && segment < radial) {
                const a = row * (radial + 1) + segment;
                const b = a + radial + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
    }
    const pool = createFxGeometry(HOODOO_SLOTS, HOODOO_STRIDE, ['aHoodooSite', 'aHoodooSize', 'aHoodooState']);
    const { geometry, data, buffer } = pool;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.deleteAttribute('uv');
    geometry.setIndex(indices);
    const site = attribute('aHoodooSite', 'vec4');
    const size = attribute('aHoodooSize', 'vec4');
    const vWorld = varying(vec3(0), 'paHoodooWorld');
    const vStrata = varying(vec3(0), 'paHoodooStrata');
    const vLight = varying(float(0), 'paHoodooLight');
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PaintedAgesHoodooStone';
    material.side = THREE.DoubleSide;
    material.vertexNode = Fn(() => {
        const age = max(u.time.sub(site.w), 0).toVar();
        const grow = smoothstep(0, 1.4, age).toVar();
        const crumble = float(1).sub(smoothstep(25, 27, age)).toVar();
        const enabled = size.w.mul(step(site.w, u.time)).mul(crumble).toVar();
        const h = positionGeometry.y.toVar();
        const theta = atan(positionGeometry.z, positionGeometry.x).toVar();
        const twist = float(1).sub(grow).mul(sin(age.mul(4.4))).mul(1.7)
            .mul(h)
            .toVar();
        const turned = theta.add(twist).toVar();
        // Hard cap beds resist erosion. One, two or three overhanging shelves count the clear.
        const bed = fract(h.mul(size.z).mul(0.97)).toVar();
        const cap = smoothstep(0.72, 0.83, bed).mul(float(1).sub(smoothstep(0.92, 0.99, bed)));
        const taper = mix(0.68, 0.34, h).add(cap.mul(0.52));
        const rough = sin(theta.mul(5).add(h.mul(9))).mul(0.05).add(sin(theta.mul(9)).mul(0.025));
        const radius = max(taper.add(rough), 0.1).mul(size.y).mul(enabled)
            .mul(float(1).sub(step(0.999, h)));
        const offset = vec3(cos(turned).mul(radius), h.mul(size.x).mul(grow).mul(enabled), sin(turned).mul(radius));
        const world = site.xyz.add(offset).toVar();
        vWorld.assign(world);
        vStrata.assign(world.add(vec3(0, sin(theta.add(age.mul(5))).mul(float(1).sub(grow)).mul(8), 0)));
        vLight.assign(cos(turned.add(0.9)).mul(0.22).add(0.72));
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
    })();
    material.fragmentNode = Fn(() => {
        paKeepOut(u).lessThan(0.5).discard();
        const rock = strataAt(vStrata, u, recordTexture).mul(vLight);
        return vec4(paHaze(u, vWorld, rock), 1);
    })();
    const mesh = createFxMesh('PaintedAgesHoodoos', geometry, material, 5);
    const dustPool = createFxGeometry(HOODOO_SLOTS, HOODOO_STRIDE, ['aHoodooSite', 'aHoodooSize', 'aHoodooState']);
    // Both draws read the same three slots; no duplicate event table or event allocation.
    for (const name of ['aHoodooSite', 'aHoodooSize', 'aHoodooState']) {
        dustPool.geometry.setAttribute(name, geometry.getAttribute(name));
    }
    const dustMaterial = createFxMaterial('PaintedAgesHoodooCrumble');
    const vDust = varying(float(0), 'paHoodooDust');
    dustMaterial.vertexNode = Fn(() => {
        const age = u.time.sub(site.w).sub(25).toVar();
        const present = smoothstep(0, 0.6, age).mul(float(1).sub(smoothstep(1, 3, age))).mul(size.w);
        const span = max(age, 0).mul(9).add(size.y.mul(2));
        const at = site.xyz.add(vec3(positionGeometry.x.mul(span), positionGeometry.y.add(0.5).mul(span).add(2), 3)
            .mul(step(0.0001, present)));
        vDust.assign(present);
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(at, 1));
    })();
    dustMaterial.fragmentNode = Fn(() => {
        const q = uv().sub(0.5).mul(2);
        const a = smoothstep(1, 0.15, q.length()).mul(vDust).mul(0.25).mul(paKeepOut(u));
        return vec4(vec3(0.58, 0.48, 0.37).mul(a), a);
    })();
    const dustMesh = createFxMesh('PaintedAgesHoodooCrumble', dustPool.geometry, dustMaterial, 35);
    const point = new Float32Array(3);
    let cursor = 0;
    const fire = ({
        time = u.time.value, side = -1, u: column, lines = 1, chute,
    } = {}) => {
        const caps = Math.min(3, Math.max(1, Math.round(lines)));
        const siteFraction = column > 0.5 || side > 0 ? 0.7 : 0.2;
        const path = chute || bake.chutes?.[Math.floor((bake.chutes.length - 1) * siteFraction)];
        if (path?.points?.length >= 6) samplePath(path.points, 0.64, point);
        else { point[0] = side < 0 ? -260 : 320; point[1] = 50; point[2] = -480; }
        const o = cursor * HOODOO_STRIDE;
        data[o] = point[0]; data[o + 1] = point[1]; data[o + 2] = point[2]; data[o + 3] = time;
        data[o + 4] = HOODOO_HEIGHTS[caps - 1];
        data[o + 5] = 11 + caps * 2; data[o + 6] = caps; data[o + 7] = 1;
        data[o + 8] = 25; data[o + 9] = path?.front || 0; data[o + 10] = 0; data[o + 11] = cursor;
        cursor = (cursor + 1) % HOODOO_SLOTS;
        buffer.needsUpdate = true;
    };
    const reset = () => { data.fill(0); cursor = 0; buffer.needsUpdate = true; };
    const exportState = () => ({
        version: 1, stride: HOODOO_STRIDE, data: Array.from(data), cursor,
    });
    const importState = (saved) => {
        if (saved?.version !== 1 || saved.stride !== HOODOO_STRIDE || saved.data?.length !== data.length) return false;
        for (let i = 0; i < data.length; i++) data[i] = Number.isFinite(saved.data[i]) ? saved.data[i] : 0;
        cursor = Math.max(0, Math.floor(Number(saved.cursor) || 0)) % HOODOO_SLOTS;
        buffer.needsUpdate = true;
        return true;
    };
    reset();
    return {
        ...pool,
        mesh,
        meshes: [mesh, dustMesh],
        material,
        count: HOODOO_SLOTS,
        fire,
        reset,
        exportState,
        importState,
        update() {},
        dispose() { geometry.dispose(); dustPool.geometry.dispose(); material.dispose(); dustMaterial.dispose(); },
    };
}
