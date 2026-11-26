/** Petals, pollen and the spore curtains share one instanced, subdivided strip. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, cameraProjectionMatrix, cameraViewMatrix, cos, exp,
    float, fract, mix, sin, smoothstep, step, uniform, uv, varying, vec3, vec4,
} from 'three/tsl';
import { blFxMaterial, blPart } from './bioluminescence-tsl.js';

const TAU = 2 * Math.PI;

export function createGrottoBloom(u, fine) {
    const strips = [];
    // Back petals go into the buffer first so the nearer glass overlays them.
    for (let bank = 0; bank < 2; bank++) {
        const petals = [];
        for (const [layer, count] of [[0, fine ? 9 : 7], [1, fine ? 7 : 5], [2, 7]]) {
            for (let i = 0; i < count; i++) {
                const theta = TAU * ((i + 0.33 * layer + 0.16 * bank) / count);
                petals.push([layer, theta, (i * 0.618 + layer * 0.33) % 1, bank]);
            }
        }
        petals.sort((a, b) => Math.sin(a[1]) * (1 - a[0] * 0.35) - Math.sin(b[1]) * (1 - b[0] * 0.35));
        strips.push(...petals);
    }
    const curtainCounts = fine ? [11, 11, 17] : [7, 7, 11];
    for (let source = 0; source < 3; source++) {
        const count = curtainCounts[source];
        for (let i = 0; i < count; i++) {
            const theta = 0.18 + (Math.PI - 0.36) * ((i + 0.5) / count);
            strips.unshift([3, theta, (i * 0.618 + 0.21 * source) % 1, source]);
        }
    }
    const source = new THREE.PlaneGeometry(1, 1, fine ? 6 : 4, fine ? 18 : 12);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(source.index);
    geometry.setAttribute('position', source.getAttribute('position'));
    geometry.setAttribute('uv', source.getAttribute('uv'));
    geometry.setAttribute('aBloomBlade', new THREE.InstancedBufferAttribute(new Float32Array(strips.flat()), 4));
    // One collapsed strip warms the pipeline at idle. The other strips submit only while lit.
    geometry.instanceCount = 1;
    const sites = Array.from({ length: 5 }, () => uniform(new THREE.Vector4()));
    const capColors = Array.from({ length: 3 }, () => uniform(new THREE.Vector3(0.25, 0.95, 0.74)));
    const clocks = uniform(new THREE.Vector2(-100, -100));
    const calm = uniform(0);
    const blade = attribute('aBloomBlade', 'vec4');
    const kind = blade.x;
    const angle = blade.y;
    const seed = blade.z;
    const bank = blade.w;
    const curtain = step(2.5, kind);
    const stamen = step(1.5, kind).mul(float(1).sub(curtain));
    const born = mix(clocks.x.add(bank.mul(0.21)), clocks.y.add(seed.mul(0.13)), curtain);
    const age = u.time.sub(born);
    const life = mix(float(4.8), float(3.4), curtain);
    const coords = varying(vec4(kind, seed, age, angle), 'blBloomBlade');
    const nearGill = mix(capColors[0], capColors[1], step(0.5, bank));
    const gill = varying(mix(nearGill, capColors[2], step(1.5, bank)), 'blFallHue');
    const material = blFxMaterial('BioluminescenceGrottoBloom');
    material.vertexNode = Fn(() => {
        const world = vec3(0, -100, 0).toVar();
        If(age.greaterThanEqual(0).and(age.lessThan(life)), () => {
            const side = uv().x.mul(2).sub(1).toVar();
            const s = uv().y.clamp(0, 1).toVar();
            const opening = mix(smoothstep(0, 0.72, age), float(1), calm).toVar();
            If(curtain.greaterThan(0.5), () => {
                const root = mix(mix(sites[2], sites[3], step(0.5, bank)), sites[4], step(1.5, bank)).toVar();
                const down = s.mul(mix(smoothstep(0, 1.25, age), float(1), calm)).toVar();
                const stream = sin(down.mul(5).sub(age.mul(mix(float(1.06), float(0.24), calm))).add(seed.mul(5.7)));
                const a = angle.add(stream.mul(down).mul(0.18)).toVar();
                const r = root.w.mul(float(0.78).add(seed.mul(0.13)).sub(down.mul(0.16))).toVar();
                const width = root.w.mul(0.097).mul(float(0.20).add(smoothstep(0, 0.13, s).mul(0.8)));
                const drop = root.y.mul(seed.mul(0.47).add(0.41)).mul(down);
                world.assign(root.xyz.add(vec3(cos(a).mul(r).add(side.mul(width)), drop.negate(), sin(a).mul(r))));
            }).Else(() => {
                const root = mix(sites[0], sites[1], step(0.5, bank)).toVar();
                const inner = step(0.5, kind).toVar();
                const a = angle.add(s.mul(0.18).mul(sin(angle))).toVar();
                // A newly exposed petal stands in the bud, then curls away from the heart.
                const spread = mix(float(0.15), float(1), opening).toVar();
                const arch = sin(s.mul(Math.PI)).toVar();
                const wide = arch.clamp(0, 1).pow(0.58).mul(mix(float(0.28), float(0.22), inner));
                const bulb = exp(s.sub(0.91).mul(s.sub(0.91)).mul(-190));
                const width = mix(wide, bulb.mul(0.064).add(0.012), stamen).mul(side).toVar();
                const radius = s.mul(s).mul(mix(float(1.04), float(0.62), inner)).mul(spread)
                    .mul(mix(float(1), float(0.49), stamen))
                    .add(arch.mul(0.14))
                    .toVar();
                const fold = side.mul(side).mul(arch).mul(0.14);
                const height = s.mul(mix(float(1.35), float(1.58), inner))
                    .sub(s.mul(s).mul(opening).mul(mix(float(0.88), float(0.46), inner)))
                    .add(arch.mul(0.35)).add(fold)
                    .add(s.mul(seed.sub(0.5)).mul(0.15));
                const growth = mix(float(0.14), float(1), opening);
                world.assign(root.xyz.add(vec3(
                    cos(a).mul(radius).sub(sin(a).mul(width)),
                    height,
                    sin(a).mul(radius).add(cos(a).mul(width)),
                ).mul(root.w).mul(growth)));
            });
        });
        return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));
    })();
    material.colorNode = Fn(() => {
        const side = abs(uv().x.mul(2).sub(1)).clamp(0, 1).toVar();
        const s = uv().y.clamp(0, 1).toVar();
        const mode = coords.x.toVar();
        const phase = coords.z.toVar();
        const random = coords.y.toVar();
        const result = vec4(0).toVar();
        If(mode.greaterThan(2.5), () => {
            const t = phase.mul(mix(float(1), float(0.34), calm)).toVar();
            const waves = cos(s.mul(random.mul(17).add(23)).sub(t.mul(random.mul(3).add(7))).add(random.mul(15)));
            const meander = sin(s.mul(9).sub(t.mul(1.4)).add(random.mul(7))).mul(2.6);
            const filaments = cos(uv().x.mul(19).add(meander).add(sin(s.mul(18).add(t)).mul(0.7))).toVar();
            const silk = smoothstep(0.36, 0.99, filaments).mul(0.55).add(0.055);
            const envelope = smoothstep(0, 0.35, phase).mul(float(1).sub(smoothstep(1.7, 3.4, phase)))
                .mul(float(1).sub(smoothstep(0.59, 1, side))).mul(float(1).sub(smoothstep(0.59, 1, s)))
                .mul(smoothstep(0, 0.14, s));
            const beads = smoothstep(0.72, 1, waves).mul(smoothstep(0.75, 1, filaments));
            const glow = silk.mul(waves.mul(0.29).add(0.60)).add(beads.mul(0.38)).mul(envelope).toVar();
            const tip = mix(vec3(0.11, 1.17, 0.96), vec3(1.22, 0.24, 1.06), random);
            const hue = mix(gill, tip, smoothstep(0.08, 0.75, s).mul(0.8)).toVar();
            result.assign(vec4(hue.mul(glow).mul(1.60), glow.mul(0.23)));
        }).Else(() => {
            const env = smoothstep(0, mix(float(0.26), float(0.68), calm), phase)
                .mul(float(1).sub(smoothstep(2.65, 4.8, phase))).toVar();
            const midrib = exp(side.mul(side).mul(-115)).toVar();
            const edge = smoothstep(0.78, 0.98, side).toVar();
            const veins = abs(fract(s.mul(9).sub(side.mul(2.7)).add(sin(s.mul(8)).mul(0.21))).sub(0.5));
            const lace = exp(veins.mul(veins).mul(-350)).mul(smoothstep(0.08, 0.42, side));
            const density = float(0.33).add(midrib.mul(0.24)).add(edge.mul(0.20)).add(lace.mul(0.15))
                .mul(env);
            const facing = sin(coords.w).mul(0.5).add(0.5).toVar();
            const lit = facing.mul(0.62).add(random.mul(0.20)).add(0.17).toVar();
            const tissue = mix(vec3(0.21, 0.018, 0.57), vec3(1.18, 0.12, 0.65), s.mul(lit)).toVar();
            const vein = mix(vec3(1.0, 0.36, 0.42), vec3(0.18, 1.50, 1.32), s).toVar();
            const membrane = tissue.mul(density).mul(lit.mul(0.45).add(0.55));
            const pleats = midrib.mul(0.62).add(edge.mul(0.98)).add(lace.mul(0.45));
            const silk = membrane.add(vein.mul(pleats).mul(env).mul(lit));
            const gold = mix(vec3(0.56, 0.19, 0.026), vec3(3.3, 1.55, 0.22), smoothstep(0.72, 0.92, s));
            const pollen = mode.greaterThan(1.5).select(1, 0);
            result.assign(vec4(mix(silk, gold.mul(env), pollen), mix(density, env.mul(0.79), pollen)));
        });
        return result;
    })();
    const part = blPart('BioluminescenceGrottoBloom', geometry, material, 32);
    part.sites = sites;
    part.capColors = capColors;
    part.crown = (time) => { clocks.value.x = time; };
    part.erupt = (time) => { clocks.value.y = time; };
    part.update = (time) => {
        const { x, y } = clocks.value;
        geometry.instanceCount = time < x + 5.02 || time < y + 3.55 ? strips.length : 1;
    };
    part.reset = () => {
        clocks.value.set(-100, -100);
        geometry.instanceCount = 1;
    };
    part.setReducedMotion = (reduced) => { calm.value = reduced ? 1 : 0; };
    return part;
}
