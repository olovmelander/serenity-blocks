/** Baked washes carry quiet meltwater and four row-coloured flood braids. */
import {
    Fn, If, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot,
    float, floor, fract, length, max, mix, normalize, positionGeometry, pow, reflect, sin, smoothstep, step,
    uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
    createFxGeometry, createFxMaterial, createFxMesh, paFxNoise2, samplePath,
} from './painted-ages-air.js';
import { paHaze, paKeepOut, paSkyColour } from './painted-ages-tsl.js';

export const WATER_STRIDE = 20;
const CLEAR_WATER = Object.freeze([0.065, 0.135, 0.13]);
const MELTWATER_WIDTHS = Object.freeze([7.6, 3.3, 5]);
const FLOOD_COLOURS = Object.freeze([[0.43, 0.15, 0.13], [0.48, 0.32, 0.11], [0.22, 0.3, 0.2], [0.37, 0.19, 0.31]]);

export function createWater({ u, tier = {}, bake }) {
    const source = bake.channels || bake.meltwater || [];
    const channels = source.filter((path) => path.length >= 6);
    const segments = Math.max(48, (tier.waterSegments || tier.floodSegments || 48) * 2);
    const floodCount = Math.max(4, tier.floodChannels || 8);
    const meltCount = Math.max(3, tier.meltwaterChannels || 4);
    const fallCount = Math.max(1, tier.waterfalls || 2);
    const count = (floodCount + meltCount) * segments + fallCount;
    const attributes = ['aWaterFrom', 'aWaterTo', 'aWaterTint', 'aWaterFlow', 'aWaterSide'];
    const pool = createFxGeometry(count, WATER_STRIDE, attributes);
    const { geometry, data, buffer } = pool;
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    const fallback = new Float32Array([0, 50, -6000, 100, 30, -2500, -70, 8, -350]);
    let slot = 0;
    const write = (kind, channel, s0, s1, width, sideOffset = 0) => {
        const o = slot * WATER_STRIDE;
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const inverseLength = 1 / Math.max(0.001, Math.hypot(dx, dz));
        const sideX = dz * inverseLength;
        const sideZ = -dx * inverseLength;
        const ax = a[0] + sideX * sideOffset;
        const az = a[2] + sideZ * sideOffset;
        const bx = b[0] + sideX * sideOffset;
        const bz = b[2] + sideZ * sideOffset;
        let fromY = a[1] + 0.9;
        let toY = b[1] + 0.9;
        let fromCrossSlope = 0;
        let toCrossSlope = 0;
        if (kind !== 2 && bake.heightAt) {
            const halfX = sideX * width * 0.5;
            const halfZ = sideZ * width * 0.5;
            const leftA = bake.heightAt(ax - halfX, az - halfZ);
            const rightA = bake.heightAt(ax + halfX, az + halfZ);
            const leftB = bake.heightAt(bx - halfX, bz - halfZ);
            const rightB = bake.heightAt(bx + halfX, bz + halfZ);
            fromY = (leftA + rightA) * 0.5 + 0.9;
            toY = (leftB + rightB) * 0.5 + 0.9;
            fromCrossSlope = (rightA - leftA) / width;
            toCrossSlope = (rightB - leftB) / width;
        }
        data[o] = ax; data[o + 1] = fromY;
        data[o + 2] = a[2] + sideZ * sideOffset; data[o + 3] = s0;
        data[o + 4] = bx; data[o + 5] = toY;
        data[o + 6] = b[2] + sideZ * sideOffset; data[o + 7] = s1;
        data[o + 8] = CLEAR_WATER[0]; data[o + 9] = CLEAR_WATER[1];
        data[o + 10] = CLEAR_WATER[2]; data[o + 11] = channel % (kind === 0 ? 3 : 4);
        data[o + 12] = width; data[o + 13] = kind; data[o + 14] = -1e5; data[o + 15] = 10;
        data[o + 16] = sideX; data[o + 17] = fromCrossSlope; data[o + 18] = sideZ; data[o + 19] = toCrossSlope;
        slot += 1;
    };
    for (let channel = 0; channel < floodCount + meltCount; channel++) {
        const kind = channel < meltCount ? 0 : 1;
        const index = kind ? channel - meltCount : channel;
        const lane = kind ? index % 4 : index % 3;
        const routeIndex = Math.round((lane / (kind ? 3 : 2)) * Math.max(0, channels.length - 1));
        const path = channels[routeIndex] || fallback;
        for (let segment = 0; segment < segments; segment++) {
            const s0 = segment / segments;
            const s1 = (segment + 1) / segments;
            const nearBiasedA = 1 - (1 - s0) ** 3;
            const nearBiasedB = 1 - (1 - s1) ** 3;
            samplePath(path, nearBiasedA, a); samplePath(path, nearBiasedB, b);
            // Companion threads rejoin at the channel ends, as a braided gravel wash does.
            const braid = Math.sin(s0 * Math.PI) * Math.sin(s0 * 22 + index * 1.8) * (kind ? 3 : 1.5);
            const branchWidth = MELTWATER_WIDTHS[lane % 3];
            const width = kind ? 20 + (index % 3) * 6
                : Math.min(8, Math.max(3, branchWidth * (0.9 + Math.sin(a[2] * 0.037 + lane * 2.2) * 0.22)));
            write(kind, index, s0, s1, width, braid);
        }
    }
    for (let i = 0; i < fallCount; i++) {
        const chute = bake.chutes?.[(i * 7 + 3) % bake.chutes.length];
        if (chute?.points?.length >= 6) {
            samplePath(chute.points, 0.3, a); samplePath(chute.points, 0.76, b);
            b[0] = a[0] + (i % 2 ? 3 : -3); b[2] = a[2] + 5;
            b[1] = Math.min(b[1], a[1] - 28);
        } else {
            a[0] = i % 2 ? 330 : -300; a[1] = 95; a[2] = -650 - i * 250;
            b.set(a); b[1] -= 45; b[2] += 6;
        }
        write(2, i, 0, 1, 12);
    }
    const from = attribute('aWaterFrom', 'vec4');
    const to = attribute('aWaterTo', 'vec4');
    const tint = attribute('aWaterTint', 'vec4');
    const flow = attribute('aWaterFlow', 'vec4');
    const side = attribute('aWaterSide', 'vec4');
    const vFlow = varying(vec4(0), 'paWaterFlow');
    const vColour = varying(vec3(0), 'paWaterColour');
    const vWorld = varying(vec3(0), 'paWaterWorld');
    const vNormal = varying(vec3(0, 1, 0), 'paWaterNormal');
    const vTangent = varying(vec2(0, 1), 'paWaterTangent');
    const vPixelWidth = varying(float(1), 'paWaterPixelWidth');
    const motion = u.reducedMotion ? mix(1, 0.35, u.reducedMotion) : float(1);
    const material = createFxMaterial('PaintedAgesBraidedWater');
    material.vertexNode = Fn(() => {
        const age = u.time.sub(flow.z).toVar();
        const kind = floor(flow.y.add(0.5)).toVar();
        const along = clamp(positionGeometry.y.add(0.5), 0, 1).toVar();
        const s = mix(from.w, to.w, along).toVar();
        const arrive = clamp(age.sub(0.15).div(3), 0, 1).toVar();
        const moving = smoothstep(s.sub(0.04), s.add(0.015), arrive)
            .mul(float(1).sub(smoothstep(4, 10, age))).mul(step(0.15, age)).toVar();
        const wet = float(1).sub(smoothstep(12, 20, age));
        const present = moving.toVar();
        const width = flow.x.toVar();
        const colour = tint.rgb.toVar();
        If(kind.equal(0), () => {
            // Companion threads divide coverage rather than making higher tiers brighter.
            const main = 1 - 0.22 ** (1 / Math.ceil(meltCount / 3));
            const shallow = 1 - 0.5 ** (1 / Math.ceil((meltCount - 1) / 3));
            const tributary = 1 - 0.38 ** (1 / Math.ceil((meltCount - 2) / 3));
            present.assign(tint.w.equal(0).select(main, tint.w.equal(1).select(shallow, tributary)));
            const reached = smoothstep(s.sub(0.04), s.add(0.015), arrive);
            const mineralDepth = tint.w.equal(0).select(1, tint.w.equal(1).select(0.62, 0.82));
            colour.assign(mix(vec3(...CLEAR_WATER).mul(mineralDepth), tint.rgb, wet.mul(reached)));
        });
        If(kind.equal(2), () => {
            present.assign(step(0.65, age).mul(float(1).sub(smoothstep(5, 9, age))));
        });
        const crossDirection = vec3(side.x, mix(side.y, side.w, along), side.z);
        const across = crossDirection.mul(positionGeometry.x.mul(width).mul(step(0.001, present)));
        const at = mix(from.xyz, to.xyz, along).add(across);
        vFlow.assign(vec4(present, s, kind, tint.w));
        vColour.assign(colour);
        vWorld.assign(at);
        vNormal.assign(normalize(cross(to.xyz.sub(from.xyz), crossDirection)));
        vTangent.assign(normalize(to.xz.sub(from.xz)));
        vPixelWidth.assign(width.div(max(length(at.sub(u.eye)).mul(u.pixelAngle), 0.001)));
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(at, 1));
    })();
    material.fragmentNode = Fn(() => {
        const p = uv();
        const crossChannel = abs(p.x.sub(0.5)).mul(2);
        const lanePhase = floor(vFlow.w.add(0.5)).mul(1.37);
        const clock = u.time.mul(motion);
        const flowDomain = vec2(vWorld.x.mul(0.24).add(lanePhase), vWorld.z.mul(0.34).sub(clock.mul(0.45)));
        const current = paFxNoise2(flowDomain);
        const shoal = paFxNoise2(vWorld.xz.mul(0.035).add(lanePhase));
        const bank = shoal.mul(0.28).add(0.66);
        const depth = smoothstep(bank, 0.08, crossChannel);
        const fine = smoothstep(2.4, 0.25, length(u.eye.sub(vWorld)).mul(u.pixelAngle));
        const grain = paFxNoise2(vWorld.xz.mul(1.7));
        const phase = vWorld.z.mul(0.73).add(vWorld.x.mul(0.11)).sub(clock.mul(1.25)).add(lanePhase);
        const ripple = sin(phase).mul(0.045).add(cos(phase.mul(1.87).add(current.mul(3))).mul(0.025));
        const acrossFlow = vec3(vTangent.y, 0, vTangent.x.negate());
        const normal = normalize(vNormal.add(acrossFlow.mul(ripple))
            .add(vec3(vTangent.x, 0, vTangent.y).mul(cos(phase.mul(0.63)).mul(0.028))));
        const view = normalize(u.eye.sub(vWorld));
        const fresnel = pow(float(1).sub(clamp(dot(normal, view), 0, 1)), 5).mul(0.65).add(0.025);
        const reflectedSky = paSkyColour(u, reflect(view.negate(), normal));
        const halfLight = normalize(view.add(u.sunDir));
        const roughness = shoal.mul(0.25).add(0.45);
        const sparkle = pow(max(dot(normal, halfLight), 0), mix(90, 24, roughness)).mul(0.3).mul(fine);
        const foamGain = mix(0.16, 0.65, step(0.5, vFlow.z));
        const foam = smoothstep(0.76, 0.97, current).mul(smoothstep(0.3, 0.8, grain))
            .mul(foamGain).mul(fine);
        const distanceFade = smoothstep(8200, 5200, vWorld.z.negate());
        const pixelCoverage = mix(smoothstep(0.55, 1.6, vPixelWidth), 1, step(0.5, vFlow.z));
        const alpha = vFlow.x.mul(smoothstep(bank.add(0.035), bank.sub(0.1), crossChannel))
            .mul(mix(0.82, 1, depth)).mul(paKeepOut(u)).mul(distanceFade)
            .mul(pixelCoverage);
        const sediment = mix(vColour, vec3(0.28, 0.22, 0.17), step(0.5, vFlow.z).mul(0.24));
        const gravel = mix(vec3(0.11, 0.12, 0.105), vec3(0.24, 0.23, 0.18), grain.mul(fine).mul(0.6).add(0.25));
        const colour = mix(gravel, sediment, mix(0.55, 0.93, depth)).toVar();
        const clearReflection = vFlow.w.equal(0).select(0.85, vFlow.w.equal(1).select(0.3, 0.5))
            .mul(smoothstep(0.38, 0.78, shoal).mul(0.85).add(0.15));
        const reflection = fresnel.mul(mix(clearReflection, 0.3, step(0.5, vFlow.z)))
            .mul(depth.mul(0.6).add(0.4));
        colour.assign(mix(colour, reflectedSky, reflection).add(vec3(1, 0.96, 0.85).mul(sparkle)));
        colour.assign(mix(colour, vec3(0.76, 0.79, 0.72), foam));
        If(vFlow.z.greaterThan(1.5), () => {
            const streak = fract(p.x.mul(18).add(sin(p.y.mul(20).add(clock.mul(9))).mul(0.08)));
            colour.assign(mix(colour, vec3(0.85, 0.78, 0.61), smoothstep(0.8, 0.98, streak).mul(0.6)));
        });
        return vec4(paHaze(u, vWorld, colour).mul(alpha), alpha);
    })();
    const mesh = createFxMesh('PaintedAgesBraidedWater', geometry, material, 22);
    const setFlood = ({ time = u.time.value, colors = FLOOD_COLOURS } = {}) => {
        for (let i = 0; i < count; i++) {
            const o = i * WATER_STRIDE;
            const rgb = colors[data[o + 11] % Math.max(1, colors.length)] || FLOOD_COLOURS[data[o + 11]];
            data[o + 8] = rgb[0]; data[o + 9] = rgb[1]; data[o + 10] = rgb[2];
            data[o + 14] = time;
        }
        buffer.needsUpdate = true;
    };
    const reset = () => {
        for (let i = 0; i < count; i++) {
            const o = i * WATER_STRIDE;
            data[o + 8] = CLEAR_WATER[0]; data[o + 9] = CLEAR_WATER[1];
            data[o + 10] = CLEAR_WATER[2]; data[o + 14] = -1e5;
        }
        buffer.needsUpdate = true;
    };
    const exportState = () => {
        const colors = FLOOD_COLOURS.map((rgb) => [...rgb]);
        for (let lane = 0; lane < 4; lane++) {
            for (let i = 0; i < count; i++) {
                const o = i * WATER_STRIDE;
                if (data[o + 11] === lane) {
                    colors[lane][0] = data[o + 8];
                    colors[lane][1] = data[o + 9];
                    colors[lane][2] = data[o + 10];
                    break;
                }
            }
        }
        return { version: 1, time: data[14], colors };
    };
    const importState = (saved) => {
        if (saved?.version !== 1 || !Number.isFinite(saved.time) || saved.colors?.length !== 4) return false;
        for (let i = 0; i < 4; i++) {
            if (saved.colors[i]?.length !== 3 || !saved.colors[i].every(Number.isFinite)) return false;
        }
        setFlood(saved);
        return true;
    };
    return {
        ...pool,
        mesh,
        meshes: [mesh],
        material,
        count,
        setFlood,
        reset,
        exportState,
        importState,
        update() {},
        dispose() { geometry.dispose(); material.dispose(); },
    };
}
