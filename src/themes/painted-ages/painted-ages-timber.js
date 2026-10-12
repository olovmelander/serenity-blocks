/** Weathered timber for the static stair mesh; one small, CPU-filtered 2D field. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, attribute, clamp, dot, float, max, mix, normalWorld, normalize,
    positionWorld, pow, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import { rockNoise } from './painted-ages-rock.js';
import { paHaze, paWet } from './painted-ages-tsl.js';

export function createTimberField(size = 128) {
    if (!Number.isInteger(size) || size < 8 || (size & (size - 1)) !== 0) {
        throw new RangeError('Timber field size must be a power of two of at least 8.');
    }
    const mipmaps = [];
    let data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x + 0.5) / size;
            const v = (y + 0.5) / size;
            const broad = rockNoise(u * 4, v * 4, 4)[0];
            const fine = rockNoise(u * 16, v * 16, 16)[0];
            const grain = Math.sin((v * 28 + broad * 1.7 + fine * 0.14) * Math.PI * 2);
            const pores = Math.max(0, grain) ** 8;
            const offset = (y * size + x) * 4;
            data[offset] = Math.round((0.62 + (broad - 0.5) * 0.3 - pores * 0.25) * 255);
            data[offset + 1] = Math.round(broad * 255);
            data[offset + 2] = Math.round(pores * 255);
            data[offset + 3] = Math.round((0.65 + fine * 0.3) * 255);
        }
    }
    let width = size;
    for (;;) {
        mipmaps.push({ data, width, height: width });
        if (width === 1) break;
        const nextWidth = width / 2;
        const next = new Uint8Array(nextWidth * nextWidth * 4);
        for (let y = 0; y < nextWidth; y++) {
            for (let x = 0; x < nextWidth; x++) {
                const source = (y * 2 * width + x * 2) * 4;
                const target = (y * nextWidth + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[target + c] = Math.round((data[source + c] + data[source + 4 + c]
                        + data[source + width * 4 + c] + data[source + width * 4 + 4 + c]) * 0.25);
                }
            }
        }
        data = next;
        width = nextWidth;
    }
    const field = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    field.name = 'PaintedAgesTimberGrain';
    field.colorSpace = THREE.NoColorSpace;
    field.wrapS = THREE.RepeatWrapping;
    field.wrapT = THREE.RepeatWrapping;
    field.minFilter = THREE.LinearMipmapLinearFilter;
    field.magFilter = THREE.LinearFilter;
    field.generateMipmaps = false;
    field.mipmaps = mipmaps;
    field.needsUpdate = true;
    return field;
}

/** Retains the existing stone/shrub lighting; only constructed elements use timber shading. */
export function createDetailMaterial(u, tier) {
    const field = tier.detailOctaves > 0 ? createTimberField() : null;
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'painted-ages-weathered-boardwalk-and-thorns';
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const N = normalize(normalWorld).toVar();
        const base = attribute('color', 'vec3').toVar();
        const detail = attribute('paDetail', 'vec4').toVar();
        const sun = max(dot(N, u.sunDir), 0).toVar();
        const rgb = base.mul(vec3(0.32, 0.32, 0.42).add(vec3(1.1, 0.96, 0.7).mul(sun))).toVar();
        If(detail.z.greaterThan(0.5), () => {
            const horizon = attribute('paDetailHorizon', 'float');
            const shadow = smoothstep(horizon.sub(0.055), horizon.add(0.055), u.sunElevation.mul(Math.PI / 180));
            const wet = paWet(u, P, sun.mul(shadow)).toVar();
            const grain = float(1).toVar();
            const roughness = float(0.84).toVar();
            if (field) {
                const sample = texture(field, detail.xy.mul(vec2(0.2, 0.9))).toVar();
                grain.assign(sample.r.sub(0.58).mul(0.38).add(1));
                roughness.assign(sample.a);
            }
            const timber = base.mul(grain).mul(float(1).sub(wet.mul(0.24)));
            const ambient = vec3(0.29, 0.32, 0.41).mul(clamp(detail.w, 0.25, 1));
            const direct = vec3(1.05, 0.96, 0.79).mul(sun).mul(shadow);
            rgb.assign(timber.mul(ambient.add(direct)));
            const view = normalize(u.eye.sub(P));
            const halfVector = normalize(view.add(u.sunDir));
            const facing = clamp(dot(N, halfVector), 0, 1);
            const sheen = pow(facing, mix(float(18), float(48), wet))
                .mul(float(1).sub(roughness.mul(0.72))).mul(wet.mul(0.22).add(0.025));
            rgb.addAssign(vec3(1, 0.92, 0.76).mul(sheen).mul(shadow).mul(sun));
        });
        return paHaze(u, P, rgb);
    })();
    return { material, dispose: () => { material.dispose(); field?.dispose(); } };
}
