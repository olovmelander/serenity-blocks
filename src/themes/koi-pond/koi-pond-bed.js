/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Koi Pond — the ground: the pebbled bed under the water and the mossy bank above it.
 *
 * One mesh follows groundHeight(). Under the waterline it is river pebbles (a field baked once
 * on the CPU: rounded stones of seven colours, their height and their normals), lit by the
 * moon through the surface — caustics, the shadows of whatever swims or floats above, the
 * water taking the red out of the light as the bed falls away into the basin, where it turns
 * to dark silt. Above the waterline it is moss and earth, dark and wet at the water's edge.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, clamp, dot, float, max, mix, normalWorld, normalize, positionWorld, smoothstep, texture, vec3, vec4,
} from 'three/tsl';
import { groundHeight } from './koi-pond-core.js';
import { bakePebbles } from './koi-pond-pebbles.js';

// The pebble field is baked in its own three-free module, so a worker can bake it (koi-pond-theme.js).
export { bakePebbles };

/** Metres one repeat of the pebble field covers, per 1024 pixels. */
const PEBBLE_TILE = 4.4;

function pebbleTexture(data, size, name) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = name;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
}

/** The ground mesh: a grid over everything the camera can see, finer where the bank is. */
export function buildGroundGeometry({
    minX = -17, maxX = 17, minZ = -18, maxZ = 8.5, cell = 0.18,
} = {}) {
    const nx = Math.round((maxX - minX) / cell);
    const nz = Math.round((maxZ - minZ) / cell);
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
    let at = 0;
    for (let j = 0; j <= nz; j += 1) {
        const z = minZ + ((maxZ - minZ) * j) / nz;
        for (let i = 0; i <= nx; i += 1) {
            const x = minX + ((maxX - minX) * i) / nx;
            positions[at] = x;
            positions[at + 1] = groundHeight(x, z);
            positions[at + 2] = z;
            at += 3;
        }
    }
    const indices = new Uint32Array(nx * nz * 6);
    let k = 0;
    for (let j = 0; j < nz; j += 1) {
        for (let i = 0; i < nx; i += 1) {
            const a = j * (nx + 1) + i;
            const b = a + 1;
            const c = a + nx + 1;
            const d = c + 1;
            indices[k] = a;
            indices[k + 1] = c;
            indices[k + 2] = b;
            indices[k + 3] = b;
            indices[k + 4] = c;
            indices[k + 5] = d;
            k += 6;
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * @param {PondLight} light
 * @param {object} tier
 */
export function createBed(light, tier) {
    const { u } = light;
    const baked = bakePebbles(tier.pebbles);
    const colourTex = pebbleTexture(baked.colour, baked.size, 'koi-pond-pebbles');
    const reliefTex = pebbleTexture(baked.relief, baked.size, 'koi-pond-pebble-relief');
    const tile = PEBBLE_TILE * (baked.size / 1024);

    const shade = Fn(() => {
        const point = positionWorld.toVar();
        const depth = max(point.y.negate(), 0.0).toVar();
        const geoNormal = normalize(normalWorld).toVar();
        const lit = light.moonlight().toVar();

        // ── Pebbles ──
        const st = point.xz.div(tile);
        const stone = texture(colourTex, st);
        const relief = texture(reliefTex, st);
        const broad = light.noise.sample(point.xz.mul(0.043)).toVar();
        const fine = light.noise.sample(point.xz.mul(0.31));
        // Patches of algae on the shelf, pale sand between them, silt in the basin.
        const algae = smoothstep(0.52, 0.8, broad.r.add(fine.g.mul(0.25)));
        const sand = smoothstep(0.6, 0.9, broad.g);
        const pebble = stone.rgb.mul(0.74).mul(mix(vec3(1.0), vec3(0.62, 0.95, 0.6), algae.mul(0.6)))
            .mul(mix(vec3(1.0), vec3(1.3, 1.2, 1.0), sand.mul(0.45))).toVar();
        const silt = vec3(0.045, 0.062, 0.058).mul(fine.b.mul(0.5).add(0.75));
        const deep = smoothstep(1.05, 2.3, depth);
        const bedColour = mix(pebble, silt, deep);
        const tilt = relief.xy.sub(0.5).mul(mix(1.7, 0.2, deep));
        const bedNormal = normalize(geoNormal.add(vec3(tilt.x, 0, tilt.y)));

        const toMoonUnder = normalize(vec3(u.underSlope.x, 1.0, u.underSlope.y));
        const facing = clamp(dot(bedNormal, toMoonUnder), 0.0, 1.0);
        const gathered = tier.prism ? light.causticRGB(point) : vec3(light.caustic(point));
        const moon = u.moonColor.mul(gathered).mul(light.downwelling(depth)).mul(facing.mul(lit)).mul(1.3);
        const hush = u.breath.mul(0.75).add(0.25);
        const ambient = u.waterAmbient.mul(relief.z.mul(0.55).add(0.45)).mul(light.downwelling(depth.mul(0.6)));
        const lamp = light.lantern(point, bedNormal);
        const band = light.ringLight(point.xz).mul(light.downwelling(depth.mul(0.5)));
        const under = bedColour.mul(moon.mul(hush).add(ambient).add(lamp)).add(band.mul(bedColour.add(0.06)).mul(1.6));

        // ── The bank ──
        // Cushions of moss over dark earth, gravel showing through here and there; the garden
        // falls away into the dark behind the first few paces of bank.
        const clump = light.noise.sample(point.xz.mul(1.25));
        const tuft = light.noise.sample(point.xz.mul(4.1));
        const mossy = smoothstep(0.34, 0.6, broad.r.mul(0.35).add(clump.g.mul(0.45)).add(fine.g.mul(0.2)));
        const gravel = smoothstep(0.62, 0.8, clump.r.mul(0.6).add(broad.b.mul(0.4))).mul(mossy.oneMinus());
        const earth = vec3(0.034, 0.027, 0.02).mul(fine.b.mul(0.6).add(0.7));
        const moss = mix(vec3(0.014, 0.04, 0.012), vec3(0.045, 0.1, 0.022), tuft.r.mul(0.6).add(clump.b.mul(0.4)))
            .mul(tuft.a.mul(0.5).add(0.75));
        const wet = smoothstep(0.16, 0.0, point.y);
        const shoreStone = stone.rgb.mul(0.5);
        const dry = mix(mix(earth, moss, mossy), stone.rgb.mul(0.3), gravel.mul(0.8));
        const recede = float(1.0).sub(smoothstep(0.35, 1.5, point.y).mul(0.72))
            .mul(smoothstep(-10.5, -5.2, point.z).mul(0.86).add(0.14));
        const bankColour = mix(dry, shoreStone, wet.mul(0.85)).mul(mix(1.0, 0.55, wet)).mul(recede);
        const bankNormal = normalize(geoNormal.add(vec3(tilt.x, 0, tilt.y).mul(wet.mul(0.8).add(0.25))));
        const moonAir = u.moonColor.mul(clamp(dot(bankNormal, u.moonDir), 0.0, 1.0).mul(lit)).mul(0.95);
        // Moss catches the light along its nap: a soft rim toward the moon.
        const nap = mossy.mul(wet.oneMinus()).mul(clamp(dot(bankNormal, u.moonDir).mul(0.5).add(0.5), 0.0, 1.0)).mul(0.05);
        const over = bankColour.mul(moonAir.mul(hush).add(u.skyAmbient).add(light.lantern(point, bankNormal).mul(1.5)))
            .add(u.moonColor.mul(nap).mul(lit));

        const above = smoothstep(-0.012, 0.012, point.y);
        return vec4(mix(under, over, above), 1.0);
    });

    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'Koi Pond — bed and bank';
    material.fragmentNode = shade();

    const geometry = buildGroundGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Koi Pond — ground';
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrixWorld(true);

    return {
        mesh,
        geometry,
        material,
        tile,
        dispose() {
            colourTex.dispose();
            reliefTex.dispose();
        },
    };
}
