/**
 * Gravity-driven mineral grit, chips, slurry and talus share one fixed pool. Rain
 * lives in distant world-space sheets; the fumaroles are quiet at every tier.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp,
    dot, exp, float, floor, fract, length, max, mix, normalize, positionGeometry, pow, sin,
    smoothstep, step, texture, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { paHash21, paHaze, paKeepOut } from './painted-ages-tsl.js';

export const AIR_STRIDE = 20;
export const FAN_SLOTS = 12;
export const AIR_KIND = Object.freeze({
    dormant: 0, grit: 1, chip: 2, dust: 3, fan: 4, slurry: 5, spray: 6, ash: 7,
});

/** Smooth world/flow density shared by water and steam, with no texture or uniform captures. */
export const paFxNoise2 = Fn(([p]) => {
    const cell = floor(p);
    const f = fract(p);
    const w = f.mul(f).mul(float(3).sub(f.mul(2)));
    return mix(
        mix(paHash21(cell), paHash21(cell.add(vec2(1, 0))), w.x),
        mix(paHash21(cell.add(vec2(0, 1))), paHash21(cell.add(vec2(1, 1))), w.x),
        w.y,
    );
}).setLayout({ name: 'pa_fxNoise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** Every attribute of a pool shares one vertex buffer on both node backends. */
export function createFxGeometry(
    count,
    stride = AIR_STRIDE,
    names = ['aStart', 'aEnd', 'aTint', 'aShape', 'aState'],
    subdivisions = 1,
) {
    const geometry = new THREE.InstancedBufferGeometry();
    const vertices = [];
    const coords = [];
    const indices = [];
    for (let row = 0; row <= subdivisions; row++) {
        const y = row / subdivisions;
        vertices.push(-0.5, y - 0.5, 0, 0.5, y - 0.5, 0);
        coords.push(0, y, 1, y);
        if (row < subdivisions) {
            const index = row * 2;
            indices.push(index, index + 1, index + 2, index + 2, index + 1, index + 3);
        }
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coords, 2));
    const data = new Float32Array(count * stride);
    const buffer = new THREE.InstancedInterleavedBuffer(data, stride, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < names.length; i++) {
        geometry.setAttribute(names[i], new THREE.InterleavedBufferAttribute(buffer, 4, i * 4));
    }
    geometry.instanceCount = count;
    return { geometry, data, buffer };
}

export function createFxMaterial(name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = name;
    material.transparent = true;
    material.depthTest = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquation = THREE.AddEquation;
    return material;
}

export function createFxMesh(name, geometry, material, order = 30) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    return mesh;
}

/** Sample baked xyz polylines without allocating during a gameplay event. */
export function samplePath(points, progress, target) {
    const count = Math.floor(points.length / 3);
    const scaled = Math.min(1, Math.max(0, progress)) * (count - 1);
    const index = Math.min(count - 2, Math.floor(scaled));
    const blend = scaled - index;
    for (let axis = 0; axis < 3; axis++) {
        const a = points[index * 3 + axis];
        target[axis] = a + (points[(index + 1) * 3 + axis] - a) * blend;
    }
    return target;
}

const project = (point) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(point, 1));
const setting = (tier, name, fallback) => Number(tier?.[name]) || fallback;

/** Near event surfaces bend to the same ground; no sheet can bridge a rill in mid-air. */
function createGroundTexture(bake) {
    if (!bake.heightAt) return null;
    const size = 256;
    const pixels = new Uint16Array(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const height = bake.heightAt(-1000 + (x / (size - 1)) * 2000, -1600 + (y / (size - 1)) * 1800);
            pixels[y * size + x] = THREE.DataUtils.toHalfFloat(height);
        }
    }
    const result = new THREE.DataTexture(pixels, size, size, THREE.RedFormat, THREE.HalfFloatType);
    result.name = 'PaintedAgesNearGround';
    result.minFilter = THREE.LinearFilter;
    result.magFilter = THREE.LinearFilter;
    result.generateMipmaps = false;
    result.needsUpdate = true;
    return result;
}

export function createAir({ u, tier = {}, bake }) {
    const count = Math.max(FAN_SLOTS + 32, setting(tier, 'airPool', setting(tier, 'airCount', 160)));
    const pool = createFxGeometry(count, AIR_STRIDE, undefined, 6);
    const groundTexture = createGroundTexture(bake);
    const { geometry, data, buffer } = pool;
    const start = attribute('aStart', 'vec4');
    const end = attribute('aEnd', 'vec4');
    const tint = attribute('aTint', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const state = attribute('aState', 'vec4');
    const vLife = varying(vec4(0), 'paAirLife');
    const vTint = varying(vec3(0), 'paAirTint');
    const material = createFxMaterial('PaintedAgesMineralAir');
    material.vertexNode = Fn(() => {
        const kind = floor(tint.w.add(0.5)).toVar();
        const age = u.time.sub(start.w).sub(shape.w).toVar();
        const progress = clamp(age.div(max(end.w, 0.001)), 0, 1).toVar();
        const alive = step(0, age).mul(float(1).sub(step(end.w, age))).mul(step(0.5, kind)).toVar();
        const at = mix(start.xyz, end.xyz, progress).toVar();
        const size = shape.xy.toVar();
        const alpha = alive.toVar();
        const right = u.camRight || vec3(1, 0, 0);
        const up = u.camUp || vec3(0, 1, 0);
        const offset = right.mul(positionGeometry.x.mul(size.x)).add(up.mul(positionGeometry.y.mul(size.y))).toVar();
        If(kind.equal(AIR_KIND.grit).or(kind.equal(AIR_KIND.slurry)), () => {
            // A short piece of the run lies on the slope, not in the lens plane.
            const downhill = end.xyz.sub(start.xyz);
            offset.assign(vec3(positionGeometry.x.mul(size.x), 0.7, 0)
                .add(downhill.mul(positionGeometry.y.mul(size.y).div(max(length(downhill), 1)))));
            alpha.mulAssign(smoothstep(0, 0.05, progress).mul(float(1).sub(smoothstep(0.82, 1, progress))));
        });
        If(kind.equal(AIR_KIND.chip), () => {
            const hop = abs(sin(progress.mul(9.4248).add(shape.z)));
            at.y.addAssign(hop.mul(float(1).sub(progress)).mul(18).mul(state.w));
            at.x.addAssign(sin(shape.z).mul(progress).mul(8));
        });
        If(kind.equal(AIR_KIND.dust).or(kind.equal(AIR_KIND.spray)), () => {
            at.addAssign(vec3(age.mul(9), age.mul(6), 0));
            offset.mulAssign(progress.mul(1.8).add(0.6));
            alpha.mulAssign(sin(progress.mul(Math.PI)).mul(kind.equal(AIR_KIND.dust).select(0.24, 0.42)));
        });
        If(kind.equal(AIR_KIND.fan), () => {
            at.assign(end.xyz);
            at.y.subAssign(2);
            const x = positionGeometry.x.mul(size.x);
            const z = positionGeometry.y.mul(size.y);
            offset.assign(vec3(x, x.mul(start.x).add(z.mul(start.y)).add(1.3), z));
            alpha.assign(step(start.w, u.time)
                .mul(float(1).sub(smoothstep(0, max(state.z, 0.6), u.time.sub(state.x)))));
        });
        If(kind.equal(AIR_KIND.ash), () => {
            at.y.subAssign(age.mul(7));
            at.x.addAssign(sin(shape.z).mul(age).mul(1.5));
            alpha.mulAssign(smoothstep(0, 0.12, progress).mul(float(1).sub(smoothstep(0.7, 1, progress))));
        });
        vLife.assign(vec4(alpha, kind, kind.equal(AIR_KIND.slurry).select(state.w, shape.z), progress));
        vTint.assign(tint.rgb.mul(mix(1.12, 1, smoothstep(0, 1, max(age, 0)))));
        If(kind.equal(AIR_KIND.ash), () => { vTint.assign(tint.rgb); });
        const world = at.add(offset.mul(step(0.0001, alpha))).toVar();
        if (groundTexture) {
            If(kind.equal(AIR_KIND.grit).or(kind.equal(AIR_KIND.slurry)), () => {
                const groundUv = vec2(world.x.add(1000).div(2000), world.z.add(1600).div(1800));
                world.y.assign(texture(groundTexture, clamp(groundUv, 0.002, 0.998)).level(0).r.add(1.3));
            });
        }
        return project(world);
    })();
    material.fragmentNode = Fn(() => {
        const q = uv().sub(0.5).mul(2).toVar();
        const kind = floor(vLife.y.add(0.5)).toVar();
        const grain = fract(sin(floor(q.x.mul(32)).mul(12.9).add(floor(q.y.mul(32)).mul(39.7))
            .add(floor(vLife.z.add(0.5)))).mul(437.1));
        const edge = smoothstep(1, 0.62, length(q)).toVar();
        const colour = vTint.mul(grain.mul(0.28).add(0.76)).toVar();
        If(kind.equal(AIR_KIND.fan), () => {
            // Fan apex meets the chute; its rounded foot is loose rock, without a light halo.
            const gritEdge = sin(q.x.mul(23).add(sin(q.y.mul(15)))).mul(0.08);
            const fanRadius = length(vec2(q.x.div(q.y.mul(0.3).add(0.72)), q.y)).add(gritEdge);
            edge.assign(smoothstep(1, 0.55, fanRadius).mul(smoothstep(0.08, 0.32, grain)));
            colour.assign(mix(vTint, vec3(0.27, 0.22, 0.19), 0.4).mul(grain.mul(0.35).add(0.68)));
        });
        If(kind.equal(AIR_KIND.grit).or(kind.equal(AIR_KIND.slurry)), () => {
            edge.assign(smoothstep(1, 0.76, abs(q.x)).mul(smoothstep(1, 0.64, abs(q.y))));
        });
        If(kind.equal(AIR_KIND.grit), () => {
            const ragged = sin(q.y.mul(17).add(vLife.z)).mul(0.13);
            edge.assign(smoothstep(1, 0.5, abs(q.x.add(ragged))).mul(smoothstep(1, 0.58, abs(q.y)))
                .mul(smoothstep(0.08, 0.32, grain)));
        });
        If(kind.equal(AIR_KIND.slurry), () => {
            // Adjacent cell colours belong to one tapered, broken sheet, not ten tiles.
            const sheetX = vLife.z.sub(0.5).mul(2).add(q.x.mul(0.1));
            const ragged = sin(sheetX.mul(13)).mul(0.15).add(sin(sheetX.mul(31)).mul(0.075));
            const spread = q.y.mul(0.18).add(0.78);
            edge.assign(smoothstep(1, 0.68, abs(sheetX).div(spread))
                .mul(smoothstep(1, 0.5, abs(q.y.add(ragged))))
                .mul(smoothstep(0.02, 0.18, grain)));
            colour.assign(mix(vTint, vec3(0.3, 0.25, 0.22), 0.6).mul(grain.mul(0.1).add(0.86)));
        });
        If(kind.equal(AIR_KIND.chip), () => {
            edge.assign(step(abs(q.x).mul(0.8).add(abs(q.y)), 1));
        });
        If(kind.equal(AIR_KIND.dust).or(kind.equal(AIR_KIND.spray)), () => {
            edge.assign(exp(q.dot(q).mul(-3.6)).mul(smoothstep(1, 0.5, length(q))));
            colour.assign(mix(vTint, vec3(0.7, 0.64, 0.54), 0.65));
        });
        const alpha = clamp(edge.mul(vLife.x), 0, 0.98).mul(paKeepOut(u));
        return vec4(colour.mul(alpha), alpha);
    })();
    const mesh = createFxMesh('PaintedAgesMineralAir', geometry, material);
    const curtains = createCurtains({ u, tier, bake });
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    const colour = new THREE.Color();
    let nextParticle = FAN_SLOTS;
    let nextFan = 0;
    let sequence = 0;
    let lastBurst = -1000;
    const write = (slot, kind, time, duration, rgb, width, height, front, reduced = 1, delay = 0) => {
        const o = slot * AIR_STRIDE;
        data[o] = a[0]; data[o + 1] = a[1] + 2; data[o + 2] = a[2]; data[o + 3] = time;
        data[o + 4] = b[0]; data[o + 5] = b[1] + 2; data[o + 6] = b[2]; data[o + 7] = duration;
        if (Array.isArray(rgb) || ArrayBuffer.isView(rgb)) colour.setRGB(rgb[0], rgb[1], rgb[2]);
        else if (rgb?.isColor) colour.copy(rgb);
        else colour.set(rgb ?? '#b58d69');
        data[o + 8] = colour.r; data[o + 9] = colour.g; data[o + 10] = colour.b; data[o + 11] = kind;
        data[o + 12] = width; data[o + 13] = height; data[o + 14] = sequence % 61; data[o + 15] = delay;
        data[o + 16] = 1e9; data[o + 17] = front || 0; data[o + 18] = 0.6; data[o + 19] = reduced;
        sequence += 1;
    };
    const particle = () => {
        const slot = nextParticle;
        nextParticle = nextParticle + 1 >= count ? FAN_SLOTS : nextParticle + 1;
        return slot;
    };
    const reset = () => {
        data.fill(0);
        nextParticle = FAN_SLOTS; nextFan = 0; sequence = 0; lastBurst = -1000;
        buffer.needsUpdate = true;
    };
    const fire = ({
        chute = bake.chutes[0], time = u.time.value, color, hardDrop = false, distance = 0, reduceMotion = false,
    }) => {
        if (!chute?.points || chute.points.length < 6) return;
        const { points } = chute;
        const width = hardDrop ? 1.6 + Math.min(distance, 30) / 20 : 1;
        const duration = reduceMotion ? 0.6 : 1.1;
        samplePath(points, 0, a); samplePath(points, 1, b);
        const routeLength = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const eye = u.eye?.value;
        const forward = u.camForward?.value;
        let cellMetres = 16;
        if (eye && forward) {
            const depth = Math.max(20, (a[0] - eye.x) * forward.x
                + (a[1] - eye.y) * forward.y + (a[2] - eye.z) * forward.z);
            const card = u.boardCalm?.value;
            const cardWidth = card && card.z > card.x ? card.z - card.x : 0.3;
            cellMetres = (depth * 2 * (u.tanHalfFov?.value || 0.38) * (u.aspect?.value || 1.78) * cardWidth) / 10;
        }
        const runWidth = Math.max(2.6, Math.min(18, cellMetres));
        const patchLength = Math.max(2, Math.min(18, routeLength * 0.24));
        const totalWidth = runWidth * width;
        for (let i = 0; i < 9; i++) {
            samplePath(points, i / 12, a);
            samplePath(points, Math.min(1, i / 12 + 0.38), b);
            write(particle(), AIR_KIND.grit, time, duration, color, totalWidth, patchLength, chute.front, 1, i * 0.025);
        }
        if (!reduceMotion) {
            const chips = hardDrop ? Math.min(12, 6 + Math.floor(distance / 3)) : 4;
            for (let i = 0; i < chips; i++) {
                samplePath(points, i / (chips * 3), a);
                samplePath(points, 0.7 + i / (chips * 4), b);
                const chipSize = hardDrop ? 5 : 3;
                write(particle(), AIR_KIND.chip, time, duration, color, chipSize, chipSize + 1, chute.front);
            }
        }
        samplePath(points, 0.2, a); samplePath(points, 0.85, b);
        const burst = time - lastBurst >= 1;
        if (burst) {
            write(particle(), AIR_KIND.dust, time, 1.8, color, hardDrop ? 48 : 27, hardDrop ? 35 : 23, chute.front);
            lastBurst = time;
        }
        samplePath(points, 1, b); a.set(b);
        const oldest = nextFan * AIR_STRIDE;
        if (data[oldest + 11] === AIR_KIND.fan && data[oldest + 16] > time) {
            // A thirteenth fan incorporates the oldest into neutral talus over two seconds.
            const merged = particle() * AIR_STRIDE;
            data.copyWithin(merged, oldest, oldest + AIR_STRIDE);
            data[merged + 16] = time;
            data[merged + 18] = 2;
            data[merged + 8] = data[merged + 8] * 0.5 + 0.22;
            data[merged + 9] = data[merged + 9] * 0.5 + 0.17;
            data[merged + 10] = data[merged + 10] * 0.5 + 0.12;
        }
        let fanWidth = runWidth * 1.25 * width;
        let fanLength = fanWidth * 0.74;
        let fanSlopeX = 0;
        let fanSlopeZ = 0;
        if (bake.heightAt) {
            // A talus patch stays on the local foot rather than wrapping a nearby cliff.
            const ground = bake.heightAt(b[0], b[2]);
            for (let pass = 0; pass < 4; pass++) {
                const xSpan = Math.max(
                    Math.abs(bake.heightAt(b[0] - fanWidth * 0.5, b[2]) - ground),
                    Math.abs(bake.heightAt(b[0] + fanWidth * 0.5, b[2]) - ground),
                );
                const zSpan = Math.max(
                    Math.abs(bake.heightAt(b[0], b[2] - fanLength * 0.5) - ground),
                    Math.abs(bake.heightAt(b[0], b[2] + fanLength * 0.5) - ground),
                );
                fanWidth *= Math.min(1, 2 / Math.max(xSpan, 0.001));
                fanLength *= Math.min(1, 2 / Math.max(zSpan, 0.001));
            }
            fanSlopeX = (bake.heightAt(b[0] + fanWidth * 0.5, b[2])
                - bake.heightAt(b[0] - fanWidth * 0.5, b[2])) / Math.max(fanWidth, 0.001);
            fanSlopeZ = (bake.heightAt(b[0], b[2] + fanLength * 0.5)
                - bake.heightAt(b[0], b[2] - fanLength * 0.5)) / Math.max(fanLength, 0.001);
            b[1] = ground;
        }
        write(nextFan, AIR_KIND.fan, time + duration * 0.7, 1e8, color, fanWidth, fanLength, chute.front);
        // Fan starts encode the local slope; their position is always the endpoint.
        data[nextFan * AIR_STRIDE] = fanSlopeX;
        data[nextFan * AIR_STRIDE + 1] = fanSlopeZ;
        nextFan = (nextFan + 1) % FAN_SLOTS;
        buffer.needsUpdate = true;
    };
    const slurry = ({
        chute, front = 0, time = u.time.value, colors = [],
    }) => {
        const route = chute || bake.chutes.find((candidate) => candidate.front === front) || bake.chutes[0];
        if (!route?.points || route.points.length < 6) return;
        const { points } = route;
        samplePath(points, 0, a); samplePath(points, 1, b);
        const routeLength = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const portrait = u.aspect?.value < 0.62;
        const lane = Math.max(portrait ? 1.8 : 3.4, Math.min(5.8, routeLength * 0.035));
        const sheetLength = Math.max(portrait ? 5 : 13, Math.min(28, routeLength * 0.25));
        for (let i = 0; i < 10; i++) {
            samplePath(points, 0, a); samplePath(points, 1, b);
            const lateral = (i - 4.5) * lane;
            a[0] += lateral; b[0] += lateral * 1.2;
            const rgb = colors[i % Math.max(colors.length, 1)];
            write(
                particle(),
                AIR_KIND.slurry,
                time,
                0.8,
                rgb,
                lane * 1.3,
                sheetLength,
                route.front,
                (i + 0.5) / 10,
                i * 0.008,
            );
        }
        buffer.needsUpdate = true;
    };
    const bury = ({ front, time = u.time.value } = {}) => {
        for (let i = 0; i < FAN_SLOTS; i++) {
            const o = i * AIR_STRIDE;
            if (front === undefined || data[o + 17] === front) data[o + 16] = Math.min(data[o + 16], time);
        }
        buffer.needsUpdate = true;
    };
    const spray = ({ chute = bake.chutes[0], time = u.time.value } = {}) => {
        if (!chute?.points || chute.points.length < 6) return;
        for (let i = 0; i < 4; i++) {
            samplePath(chute.points, 0.75, a);
            b.set(a); b[0] += (i - 1.5) * 4; b[1] += 4 + i * 3;
            write(particle(), AIR_KIND.spray, time, 5.5, '#c9c4ad', 18, 23, chute.front, 1, i * 0.15);
        }
        buffer.needsUpdate = true;
    };
    const ash = ({ time = u.time.value } = {}) => {
        const routes = u.aspect?.value < 0.8 && bake.portraitChutes?.length ? bake.portraitChutes : bake.chutes;
        if (!routes?.length) return;
        const flakes = Math.min(count - FAN_SLOTS, 48);
        for (let i = 0; i < flakes; i++) {
            const chute = routes[(i * 7) % routes.length];
            if (!chute.points || chute.points.length < 6) continue;
            samplePath(chute.points, 0.45 + (i % 5) * 0.1, a);
            a[0] += Math.sin(i * 2.399) * 22;
            a[1] += 44 + (i % 7) * 4;
            b.set(a);
            const size = 2.4 + (i % 3) * 0.7;
            write(particle(), AIR_KIND.ash, time, 6, '#b9b5ab', size, size, chute.front);
        }
        buffer.needsUpdate = true;
    };
    const exportState = () => ({
        version: 1, stride: AIR_STRIDE, data: Array.from(data), nextParticle, nextFan, sequence, lastBurst,
    });
    const importState = (saved) => {
        if (saved?.version !== 1 || saved.stride !== AIR_STRIDE || !saved.data?.length) return false;
        reset();
        const lengthToCopy = Math.min(saved.data.length, data.length);
        for (let i = 0; i < lengthToCopy; i++) data[i] = Number.isFinite(saved.data[i]) ? saved.data[i] : 0;
        nextFan = Math.max(0, Math.floor(Number(saved.nextFan) || 0)) % FAN_SLOTS;
        nextParticle = FAN_SLOTS + (Math.max(0, Math.floor(Number(saved.nextParticle) || 0) - FAN_SLOTS)
            % (count - FAN_SLOTS));
        sequence = Math.max(0, Math.floor(Number(saved.sequence) || 0));
        lastBurst = Number.isFinite(saved.lastBurst) ? saved.lastBurst : -1000;
        buffer.needsUpdate = true;
        return true;
    };
    reset();
    return {
        ...pool,
        mesh,
        meshes: [mesh, curtains.mesh],
        material,
        materials: [material, curtains.material],
        count,
        fire,
        slurry,
        spray,
        ash,
        bury,
        reset,
        exportState,
        importState,
        update() {},
        dispose() { geometry.dispose(); material.dispose(); curtains.dispose(); groundTexture?.dispose(); },
    };
}

/** Curtains stay beyond 150 m and cover only local slices of the vista. */
function createCurtains({ u, tier }) {
    const count = Math.max(3, setting(tier, 'curtainSheets', 4));
    const pool = createFxGeometry(count, 8, ['aCurtain', 'aWeather']);
    for (let i = 0; i < count; i++) {
        const o = i * 8;
        pool.data[o] = i % 2 === 0 ? -1650 + i * 250 : 1600 + i * 120;
        pool.data[o + 1] = i * 330;
        pool.data[o + 2] = 610 + i * 75;
        pool.data[o + 3] = 830 + i * 70;
        pool.data[o + 4] = i * 11;
    }
    const place = attribute('aCurtain', 'vec4');
    const weather = attribute('aWeather', 'vec4');
    const material = createFxMaterial('PaintedAgesRainCurtains');
    const wet = u.wetZones || float(0);
    const lead = u.curtainEdge || wet;
    const motion = u.reducedMotion ? mix(1, 0.3, u.reducedMotion) : float(1);
    const vCurtain = varying(vec3(0), 'paCurtainState');
    material.vertexNode = Fn(() => {
        const cycle = sin(u.time.mul(0.012).mul(motion).add(weather.x)).mul(0.5).add(0.5);
        const strength = max(clamp(wet.mul(0.17), 0, 1), smoothstep(0.85, 1, cycle).mul(0.17));
        const z = clamp(float(-8200).add(lead.mul(850)).sub(place.y), -9600, -1100);
        const x = place.x.add(sin(u.time.mul(0.01).mul(motion).add(weather.x)).mul(170));
        vCurtain.assign(vec3(strength, weather.x, z));
        return project(vec3(x.add(positionGeometry.x.mul(place.z)), positionGeometry.y.add(0.5).mul(place.w), z));
    })();
    material.fragmentNode = Fn(() => {
        const p = uv();
        const stripe = sin(p.x.mul(370).add(p.y.mul(2)).add(vCurtain.y)).mul(0.5).add(0.5);
        const down = sin(p.y.mul(85).add(u.time.mul(10).mul(motion)).add(p.x.mul(60))).mul(0.5).add(0.5);
        const envelope = smoothstep(0, 0.2, p.x).mul(smoothstep(1, 0.72, p.x))
            .mul(smoothstep(0, 0.17, p.y)).mul(smoothstep(1, 0.67, p.y));
        const a = envelope.mul(vCurtain.x).mul(stripe.mul(down).mul(0.23).mul(motion).add(0.085)).mul(paKeepOut(u));
        const rgb = mix(vec3(0.18, 0.2, 0.3), vec3(0.74, 0.62, 0.43), float(1).sub(p.x).mul(0.5));
        return vec4(rgb.mul(a), a);
    })();
    const mesh = createFxMesh('PaintedAgesRainCurtains', pool.geometry, material, 32);
    return {
        ...pool, mesh, material, dispose() { pool.geometry.dispose(); material.dispose(); },
    };
}

/** White fumaroles: soft Beer coverage, warm sunward edge, no ground-colour glow. */
export function createSteam({ u, tier = {}, bake }) {
    const count = Math.max(2, setting(tier, 'steamSheets', 4));
    const pool = createFxGeometry(count, 12, ['aVent', 'aPlume', 'aField'], 8);
    const vents = bake.vents?.length ? bake.vents : [{ x: -150, y: 20, z: -330 }, { x: 175, y: 30, z: -570 }];
    for (let i = 0; i < count; i++) {
        const vent = vents[i % Math.min(vents.length, 2)];
        const o = i * 12;
        pool.data[o] = (vent.x ?? vent[0]) + Math.floor(i / 2) * 3;
        pool.data[o + 1] = vent.y ?? vent[1]; pool.data[o + 2] = (vent.z ?? vent[2]) + Math.floor(i / 2) * 2;
        pool.data[o + 3] = i * 7;
        pool.data[o + 4] = 30 + (i % 3) * 6;
        pool.data[o + 5] = 37 + (i % 3) * 9;
        pool.data[o + 6] = i % 2 ? 50 : -80;
        pool.data[o + 7] = bake.heightAt
            ? bake.heightAt(pool.data[o] + pool.data[o + 6], pool.data[o + 2])
            : pool.data[o + 1];
        const desktop = bake.desktopVents?.[i % 2];
        pool.data[o + 8] = desktop ? desktop.x + Math.floor(i / 2) * 3 : pool.data[o] + pool.data[o + 6];
        pool.data[o + 10] = desktop ? desktop.z + Math.floor(i / 2) * 2 : pool.data[o + 2];
        pool.data[o + 9] = bake.heightAt
            ? bake.heightAt(pool.data[o + 8], pool.data[o + 10]) : desktop?.y ?? pool.data[o + 7];
    }
    const vent = attribute('aVent', 'vec4');
    const plume = attribute('aPlume', 'vec4');
    const field = attribute('aField', 'vec4');
    const material = createFxMaterial('PaintedAgesFumaroles');
    const vSeed = varying(vent.w, 'paSteamSeed');
    const vWorld = varying(vec3(0), 'paSteamWorld');
    const motion = u.reducedMotion ? mix(1, 0.4, u.reducedMotion) : float(1);
    material.vertexNode = Fn(() => {
        const height = positionGeometry.y.add(0.5);
        const drift = sin(u.time.mul(0.2).mul(motion).add(vent.w).add(height.mul(6))).mul(height).mul(5);
        const size = plume.x.mul(height.mul(1.1).add(0.24));
        const x = positionGeometry.x.mul(size).add(drift).add(height.mul(height).mul(27));
        // Two points within the same fumarolic field stay outside each layout's real cards.
        const wide = smoothstep(0.62, 0.8, u.aspect);
        const origin = mix(vent.xyz, field.xyz, wide);
        const world = origin.add(vec3(x, height.mul(plume.y).add(0.7), 0));
        vWorld.assign(world);
        return project(world);
    })();
    material.fragmentNode = Fn(() => {
        const p = uv();
        const rise = p.y.sub(u.time.mul(0.035).mul(motion));
        const curl = sin(rise.mul(8).add(vSeed)).mul(0.075)
            .add(sin(rise.mul(17).sub(vSeed.mul(0.7))).mul(0.035));
        const domain = vec2(p.x.add(curl).mul(3.4).add(vSeed), rise.mul(5.2));
        const broad = paFxNoise2(domain);
        const detail = tier.detailOctaves > 0 ? paFxNoise2(domain.mul(2.17).add(vec2(8.7, 2.3))) : broad;
        const billow = mix(broad, detail, 0.28);
        const radius = p.y.mul(0.18).add(0.19);
        const across = p.x.sub(0.5).add(curl.mul(p.y)).div(radius);
        const column = exp(across.mul(across).mul(-1.7));
        const edge = smoothstep(0.5, 0.39, abs(p.x.sub(0.5)));
        const density = smoothstep(0, 0.025, p.y).mul(smoothstep(1, 0.48, p.y))
            .mul(column).mul(edge)
            .mul(smoothstep(0.16, 0.84, billow).mul(0.9).add(0.14));
        const ventSide = fract(vSeed.div(14)).mul(2);
        const coverage = mix(2.1 / Math.ceil(count / 2), 2.1 / Math.floor(count / 2), ventSide);
        const a = float(1).sub(exp(density.mul(coverage).negate())).mul(paKeepOut(u));
        const sunward = smoothstep(0.78, 0.1, p.x).mul(0.35).add(0.42);
        const view = normalize(u.eye.sub(vWorld));
        const phase = float(0.8775).div(pow(float(1.1225).sub(dot(view, u.sunDir).mul(0.7)), 1.5));
        const transmission = exp(density.mul(-1.5)).mul(0.28);
        const light = clamp(sunward.add(transmission).add(phase.mul(0.06)).sub(broad.mul(0.1)), 0, 1);
        const rgb = mix(vec3(0.42, 0.49, 0.59), vec3(0.98, 0.97, 0.92), light);
        return vec4(paHaze(u, vWorld, rgb).mul(a), a);
    })();
    const mesh = createFxMesh('PaintedAgesFumaroles', pool.geometry, material, 34);
    return {
        ...pool,
        mesh,
        meshes: [mesh],
        material,
        update() {},
        reset() {},
        dispose() { pool.geometry.dispose(); material.dispose(); },
    };
}
