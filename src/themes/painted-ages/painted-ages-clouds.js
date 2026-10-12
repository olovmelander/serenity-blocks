/** Painted Ages — a packed 2D billow field and bounded, self-shaded distant weather. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, array, clamp, dot, exp, float, int, max, mix, sin, smoothstep,
    sqrt, step, texture, vec2, vec3, vec4,
} from 'three/tsl';

/** GB stores derivatives in the base lattice coordinates, which are texture UV × 4. */
export const CLOUD_GRADIENT_SCALE = 4;
const BASE_CELLS = 4;

function periodicValue(x, y, cells, seed) {
    const hash = (ix, iy) => {
        const px = ((ix % cells) + cells) % cells;
        const py = ((iy % cells) + cells) % cells;
        let h = Math.imul(px + seed, 374761393) ^ Math.imul(py + 17, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const dx = 30 * fx * fx * (fx - 1) * (fx - 1);
    const dy = 30 * fy * fy * (fy - 1) * (fy - 1);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return [
        (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy,
        ((b - a) * (1 - sy) + (d - c) * sy) * dx,
        ((c - a) * (1 - sx) + (d - b) * sx) * dy,
    ];
}

/**
 * RGBA8, scene-linear data, with an explicit CPU mip chain:
 * R = broad periodic density/height; GB = its exact analytic gradient in UV×4 coordinates;
 * A = independent smaller erosion. Decode GB as `(sample.gb * 2 - 1) * 4`.
 * Filtering the derivatives alongside height keeps low tiers smooth without GPU differences.
 */
export function createCloudNoise(size = 128) {
    if (!Number.isInteger(size) || size < 8 || (size & (size - 1)) !== 0) {
        throw new RangeError('Cloud noise size must be a power of two of at least 8.');
    }
    const field = new Float32Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = (x + 0.5) / size;
            const v = (y + 0.5) / size;
            let height = 0;
            let gx = 0;
            let gy = 0;
            for (let octave = 0; octave < 3; octave++) {
                const cells = BASE_CELLS * 2 ** octave;
                const weight = [0.62, 0.27, 0.11][octave];
                const n = periodicValue(u * cells, v * cells, cells, 9137 + octave * 83);
                height += n[0] * weight;
                gx += n[1] * weight * (cells / BASE_CELLS);
                gy += n[2] * weight * (cells / BASE_CELLS);
            }
            const fine = periodicValue(u * 24, v * 24, 24, 17291)[0] * 0.7
                + periodicValue(u * 48, v * 48, 48, 6931)[0] * 0.3;
            const offset = (y * size + x) * 4;
            field[offset] = height;
            field[offset + 1] = gx / (CLOUD_GRADIENT_SCALE * 2) + 0.5;
            field[offset + 2] = gy / (CLOUD_GRADIENT_SCALE * 2) + 0.5;
            field[offset + 3] = fine;
        }
    }
    const mipmaps = [];
    let level = field;
    let width = size;
    for (;;) {
        const bytes = Uint8Array.from(level, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
        mipmaps.push({ data: bytes, width, height: width });
        if (width === 1) break;
        const nextWidth = width / 2;
        const next = new Float32Array(nextWidth * nextWidth * 4);
        for (let y = 0; y < nextWidth; y++) {
            for (let x = 0; x < nextWidth; x++) {
                const source = (y * 2 * width + x * 2) * 4;
                const target = (y * nextWidth + x) * 4;
                for (let c = 0; c < 4; c++) {
                    next[target + c] = (level[source + c] + level[source + 4 + c]
                        + level[source + width * 4 + c] + level[source + width * 4 + 4 + c]) * 0.25;
                }
            }
        }
        level = next;
        width = nextWidth;
    }
    const tex = new THREE.DataTexture(mipmaps[0].data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.name = 'PaintedAgesCloudField';
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.mipmaps = mipmaps;
    tex.needsUpdate = true;
    return tex;
}

/** Forward ray interval, including an inside-origin light ray. No texture/uniform capture. */
const cloudInterval = Fn(([direction, origin, centre, radii]) => {
    const q = origin.sub(centre).div(radii);
    const ray = direction.div(radii);
    const a = max(dot(ray, ray), 1e-12);
    const b = dot(q, ray);
    const discriminant = b.mul(b).sub(a.mul(dot(q, q).sub(1)));
    const root = sqrt(max(discriminant, 0));
    const enter = max(b.negate().sub(root).div(a), 0);
    const leave = max(b.negate().add(root).div(a), 0);
    return vec2(enter, max(leave.sub(enter), 0).mul(step(0, discriminant)));
}).setLayout({
    name: 'paCloud_interval',
    type: 'vec2',
    inputs: [
        { name: 'direction', type: 'vec3' }, { name: 'origin', type: 'vec3' },
        { name: 'centre', type: 'vec3' }, { name: 'radii', type: 'vec3' },
    ],
});

// Connected base, dominant tower, smaller overlapping shoulders and a low windward tail.
// All dimensions are fractions of the existing angular bank width; nothing fills the sky.
const RAIN_LOBES = [
    [0, 0.132, 1.08, 0.012, 0.62, 0.75],
    [-0.42, 0.148, 0.54, 0.022, 0.55, 0.83],
    [0.06, 0.159, 0.47, 0.033, 0.64, 1],
    [0.51, 0.145, 0.48, 0.019, 0.51, 0.73],
    [-0.74, 0.139, 0.39, 0.013, 0.46, 0.57],
    [1.04, 0.134, 0.68, 0.008, 0.36, 0.28],
];

/**
 * Straight scene-linear RGB/alpha for the far bank; callers retain the existing virga.
 * A bounded six-lobe analytic volume: one density read on Low, two on High. The lobes
 * contribute to one optical body and one normal, so their overlaps do not paint circles.
 * There is no ray march, intermediate target, 3D texture, or GPU noise evaluation.
 */
export function paRainCloud(u, direction, cloudNoise, tier = {}) {
    return Fn(() => {
        const result = vec4(0).toVar();
        const motion = mix(float(1), float(0.4), u.reducedMotion);
        const showerX = sin(u.time.mul(0.008).mul(motion)).mul(0.19).add(0.28);
        const width = mix(float(0.075), float(0.12), clamp(u.wetZones.div(7), 0, 1));
        const depth = float(10000).add(u.eye.z);
        const centre = u.eye.add(vec3(showerX.mul(depth), depth.mul(0.153), depth.negate()));
        const boundRadii = vec3(width.mul(depth).mul(1.8), depth.mul(0.065), width.mul(depth));
        const bound = cloudInterval(direction, u.eye, centre, boundRadii);
        If(bound.y.greaterThan(0.01), () => {
            const plane = u.eye.add(direction.mul(depth.div(max(direction.z.negate(), 0.08))));
            const local = vec2(
                plane.x.sub(centre.x).div(width.mul(depth)),
                plane.y.sub(centre.y).div(depth.mul(0.055)),
            );
            const fieldUV = local.mul(vec2(0.36, 0.31)).add(vec2(u.time.mul(0.00045).mul(motion), 0.37));
            const field = texture(cloudNoise, fieldUV).level(0).toVar();
            let erosion = field.r.mul(0.4).add(field.a.mul(0.6));
            if ((tier.lenticularPlates ?? 5) >= 5) {
                // The second broad field makes curved rim scallops; fine A at this scale
                // would turn the distant edge into pixel grit instead of wind-torn cloud.
                erosion = texture(cloudNoise, fieldUV.mul(2.7).add(vec2(0.17, 0.63)))
                    .level(1).r.toVar('paCloudErosion');
            }
            const gradient = field.gb.mul(2).sub(1).mul(CLOUD_GRADIENT_SCALE);
            const warp = field.r.sub(0.5).mul(depth).mul(0.03)
                .add(erosion.sub(0.5).mul(depth).mul(0.006));
            const optical = float(0).toVar();
            const normalSum = vec3(0).toVar();
            const lightDepth = float(0).toVar();
            const weightSum = float(0).toVar();
            const interiorY = float(0).toVar();
            const shapes = array(RAIN_LOBES.map(([x, y, rx, ry]) => vec4(x, y, rx, ry))).toConst('paCloudShapes');
            const depths = array(RAIN_LOBES.map(([, , , , rz, density]) => vec2(rz, density))).toConst('paCloudDepths');
            Loop({
                start: int(0), end: int(RAIN_LOBES.length), type: 'int', condition: '<', name: 'rainLobe',
            }, ({ rainLobe }) => {
                const shape = shapes.element(rainLobe);
                const lobe = depths.element(rainLobe);
                const c = u.eye.add(vec3(
                    showerX.add(width.mul(shape.x)).mul(depth),
                    depth.mul(shape.y).add(warp),
                    depth.negate(),
                ));
                const radii = vec3(
                    width.mul(depth).mul(shape.z).mul(erosion.sub(0.5).mul(0.16).add(1)),
                    depth.mul(shape.w).mul(field.r.sub(0.5).mul(0.42).add(1)),
                    width.mul(depth).mul(lobe.x),
                );
                const hit = cloudInterval(direction, u.eye, c, radii).toVar();
                If(hit.y.greaterThan(0.01), () => {
                    const chord = hit.y.mul(lobe.y);
                    // Quadratic weights meet with zero slope at a lobe's rim. A linear
                    // chord's square-root slope exposed circular seams inside the body.
                    const weight = chord.mul(chord).mul(0.001);
                    const point = u.eye.add(direction.mul(hit.x.add(hit.y.mul(0.28))));
                    const exit = cloudInterval(u.sunDir, point, c, radii).y;
                    const surface = u.eye.add(direction.mul(hit.x));
                    const rawNormal = surface.sub(c).div(radii.mul(radii))
                        .add(vec3(gradient.x.negate(), gradient.y.negate().mul(0.7), 0).mul(0.001));
                    const normal = rawNormal.div(sqrt(max(dot(rawNormal, rawNormal), 1e-12)));
                    optical.addAssign(chord);
                    normalSum.addAssign(normal.mul(weight));
                    lightDepth.addAssign(exit.mul(weight));
                    interiorY.addAssign(point.y.mul(weight));
                    weightSum.addAssign(weight);
                });
            });
            const amount = max(weightSum, 0.001);
            const rawN = normalSum.div(amount);
            const N = rawN.div(sqrt(max(dot(rawN, rawN), 1e-12)));
            const body = optical.mul(field.r.mul(0.55).add(0.56)).mul(0.0046);
            const rimErosion = smoothstep(0, 0.85, body).mul(erosion.sub(0.5)).mul(0.48);
            const alpha = float(1).sub(exp(max(body.sub(rimErosion), 0).negate())).mul(0.95);
            const sunTransmittance = exp(lightDepth.div(amount).mul(-0.004));
            const facing = clamp(dot(N, u.sunDir).mul(0.7).add(0.3), 0, 1);
            const aboveBase = smoothstep(0.129, 0.174, interiorY.div(amount).sub(u.eye.y).div(depth));
            const direct = facing.mul(sunTransmittance.mul(0.72).add(0.28));
            const billowLift = field.r.sub(0.48).mul(0.22).add(erosion.sub(0.5).mul(0.08));
            const lighting = clamp(direct.mul(0.62).add(aboveBase.mul(0.38)).add(billowLift), 0, 1);
            const colour = mix(vec3(0.18, 0.25, 0.38), vec3(0.78, 0.82, 0.88), lighting);
            const thin = exp(max(body, 0).mul(-0.85)).mul(float(1).sub(exp(max(body, 0).mul(-2))));
            const litRim = vec3(0.11, 0.105, 0.085).mul(thin).mul(facing);
            result.assign(vec4(colour.add(litRim), alpha));
        });
        return result;
    })();
}
