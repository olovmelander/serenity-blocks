/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/** Filaments of incandescent gas, salt spray and crater ejecta. Each stroke is a
 * cubic ribbon with its own ignition, advancing head and cooling wake. Curves
 * are written on a gameplay cue. The vertex shader carries their animation. */
import * as THREE from 'three/webgpu';
import {
    Fn, If, attribute, clamp, exp, float, length, max, mix, screenUV, sin, smoothstep, step,
    uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { DIAMOND_REACH } from './blood-moon-eclipse.js';

const STRIDE = 16;
const COPPER = [1.9, 0.27, 0.075];
const GARNET = [1.4, 0.052, 0.085];
const CORAL = [1.7, 0.19, 0.23];
const GOLD = [2.3, 0.83, 0.33];
const PEARL = [1.65, 0.95, 0.82];
const ASH = [0.28, 0.36, 0.57];
const bounded = (value, low, high) => Math.max(low, Math.min(high, value));

export function createEventTraces(shared, tier) {
    const capacity = tier.sparks < 400 ? 36 : 72;
    const segments = tier.sparks < 400 ? 12 : 22;
    const data = new Float32Array(capacity * STRIDE);
    const scales = new Float32Array(capacity);
    const ends = new Float64Array(capacity);
    const priorities = new Uint8Array(capacity);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE).setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    const strip = new THREE.PlaneGeometry(1, 1, segments, 1);
    geometry.setAttribute('position', strip.getAttribute('position').clone());
    geometry.setAttribute('uv', strip.getAttribute('uv').clone());
    geometry.setIndex(strip.index.clone());
    strip.dispose();
    for (const [index, name] of ['aTraceStart', 'aTraceEnd', 'aTraceTime', 'aTraceColor'].entries()) {
        geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, index * 4));
    }
    geometry.instanceCount = 0;
    const start = attribute('aTraceStart', 'vec4');
    const end = attribute('aTraceEnd', 'vec4');
    const timing = attribute('aTraceTime', 'vec4');
    const color = attribute('aTraceColor', 'vec4');
    const clock = uniform(0);
    const light = uniform(1);
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        forceSinglePass: true,
    });
    material.vertexNode = Fn(() => {
        const u = uv().x.toVar();
        const a = mix(start.xy, start.zw, u).toVar();
        const b = mix(start.zw, end.xy, u).toVar();
        const c = mix(end.xy, end.zw, u).toVar();
        const p = mix(a, b, u).toVar();
        const q = mix(b, c, u).toVar();
        const tangent = q.sub(p).toVar();
        const normal = vec2(tangent.y.negate(), tangent.x).div(max(length(tangent), 0.00001));
        const taper = u.mul(float(1).sub(u)).mul(3).add(0.24);
        const thickness = max(timing.w.abs(), float(2.4).div(shared.viewport.y));
        const point = mix(p, q, u).add(normal.mul(uv().y.mul(2).sub(1)).mul(thickness).mul(taper));
        return vec4(point.div(vec2(shared.aspect, 1)).mul(2).sub(1), 0.66, 1);
    })();
    material.outputNode = Fn(() => {
        const u = clamp(uv().x, 0, 1).toVar();
        const side = uv().y.mul(2).sub(1).abs().toVar();
        const age = clock.sub(timing.x).mul(timing.y).toVar();
        // Negative cooling describes a ballistic ember. Only its travelling
        // head and very short wake burn; the parabola itself stays invisible.
        const ember = step(timing.z, -0.01).toVar();
        const head = clamp(age.mul(mix(2.35, 1.35, ember)), 0, 1.45).toVar();
        const behind = head.sub(u).toVar();
        const envelope = smoothstep(0, 0.14, age).mul(float(1).sub(smoothstep(0.46, 1, age)));
        const wake = smoothstep(-0.045, 0.02, behind).mul(exp(max(behind, 0).mul(timing.z.abs().negate())));
        const spark = exp(behind.mul(mix(10, 36, ember)).pow2().negate()).mul(mix(0.56, 1.2, ember));
        const core = exp(side.mul(-7)).toVar();
        const skirt = exp(side.pow2().mul(-3.3)).mul(float(1).sub(smoothstep(0.7, 1, side)));
        const endsFade = smoothstep(0, 0.06, u).mul(float(1).sub(smoothstep(0.88, 1, u)));
        const facets = float(1).toVar();
        If(timing.w.lessThan(0), () => {
            // Only the broken faces of horizontal wavelets return the trailing
            // light. The hot advancing point stays sharp above its reflection.
            const wind = screenUV.y.mul(964).add(sin(screenUV.x.mul(47).add(age)).mul(1.8))
                .add(sin(screenUV.x.mul(153).sub(age.mul(1.8))).mul(0.68)).toVar();
            const rough = sin(wind).add(sin(wind.mul(0.37).add(screenUV.x.mul(22))).mul(0.55));
            facets.assign(smoothstep(-0.7, 0.79, rough).mul(0.87).add(0.13));
        });
        const rgb = color.rgb.mul(skirt.mul(0.23).add(core)).mul(wake.mul(facets).add(spark))
            .add(vec3(1.5, 0.88, 0.54).mul(core).mul(spark));
        return vec4(rgb.mul(envelope).mul(endsFade).mul(color.a).mul(light), 0);
    })();
    const object = new THREE.Mesh(geometry, material);
    object.name = 'blood-moon-event-filaments';
    object.frustumCulled = false;
    object.renderOrder = 6;
    object.visible = false;

    let count = 0;
    let serial = 0;
    let dirty = false;
    let writingPriority = 0;
    let reflected = false;
    // origin and axes of the current group, in viewport heights (bottom left).
    let ox = 0; let oy = 0; let xx = 1; let xy = 0; let yx = 0; let yy = 1;
    function frame(x, y, scale, rotation = 0, mirror = 1) {
        ox = x; oy = y;
        const c = Math.cos(rotation) * scale;
        const s = Math.sin(rotation) * scale;
        xx = c * mirror; xy = s * mirror; yx = -s; yy = c;
    }
    function stroke(points, hue, energy, width, delay, life, cooling = 0.8) {
        let index = count;
        if (count === capacity) {
            // A twig of salt spray cannot evict a diamond ray. Equal-priority
            // strokes may replace a curve once its head has cooled.
            index = -1;
            for (let i = 0; i < count; i++) {
                if (priorities[i] > writingPriority
                    || (priorities[i] === writingPriority && ends[i] - clock.value > scales[i] * 0.38)) continue;
                if (index < 0 || priorities[i] < priorities[index]
                    || (priorities[i] === priorities[index] && ends[i] < ends[index])) index = i;
            }
            if (index < 0) return;
        } else count++;
        const off = index * STRIDE;
        for (let i = 0; i < 8; i += 2) {
            data[off + i] = ox + xx * points[i] + yx * points[i + 1];
            data[off + i + 1] = oy + xy * points[i] + yy * points[i + 1];
        }
        data[off + 8] = clock.value + delay;
        data[off + 9] = 1 / life;
        data[off + 10] = cooling;
        data[off + 11] = reflected ? -width : width;
        data[off + 12] = hue[0]; data[off + 13] = hue[1]; data[off + 14] = hue[2]; data[off + 15] = energy;
        scales[index] = life;
        ends[index] = clock.value + delay + life;
        priorities[index] = writingPriority;
        dirty = true;
    }
    function cue(kind, payload, layout, waterSite) {
        const phase = ((serial++ * 0.618034 + 0.27) % 1);
        const aspect = shared.aspect.value;
        const mx = shared.center.value.x * aspect;
        const my = shared.center.value.y;
        const r = shared.radius.value;
        const shore = waterSite.x * aspect;
        const shoreY = waterSite.y;
        const lines = bounded(Number(payload?.lineCount ?? payload?.lines) || 1, 1, 4);
        const { horizon } = layout;
        writingPriority = 1;
        reflected = kind === 'clear' && lines > 1;
        if (kind === 'lock' || kind === 'hardDrop') {
            frame(shore, shoreY, 1);
            if (kind === 'hardDrop') {
                const distance = bounded(Number(payload?.distance) || 10, 1, 22);
                const height = 0.075 + distance * 0.0035;
                stroke(
                    [-0.042, height, -0.025, height * 0.5, -0.005, 0.014, 0, 0],
                    GOLD,
                    0.75,
                    0.003,
                    0,
                    0.55,
                    3.8,
                );
            }
            for (let i = 0; i < (kind === 'hardDrop' ? 5 : 3); i++) {
                const side = i % 2 ? -1 : 1;
                const width = (0.014 + i * 0.005) * side;
                const height = 0.011 + (i % 3) * 0.009;
                stroke(
                    [0, 0, width * 0.2, height, width * 0.7, height, width, -0.003],
                    i % 2 ? CORAL : GOLD,
                    kind === 'lock' ? 0.38 : 0.78,
                    0.0024,
                    i * 0.026,
                    0.68,
                    2.1,
                );
            }
        } else if (kind === 'clear') {
            // A single spark skates across the salt. Doubles fork apart in a
            // hot wake; triples spread a fan of three crescent-shaped breakers.
            writingPriority = 2;
            const spread = Math.min(aspect * 0.32, lines === 1 ? 0.19 : 0.265);
            const origin = bounded(shore, spread * 0.7, aspect - spread * 0.7);
            frame(origin, shoreY, spread);
            if (lines === 1) {
                stroke([-0.82, 0.04, -0.48, -0.13, 0.34, 0.12, 0.86, 0.035], GOLD, 1.15, 0.006, 0, 1.32, 1.4);
                stroke([0.08, 0.015, 0.38, 0.06, 0.68, -0.095, 0.96, -0.07], COPPER, 0.85, 0.004, 0.12, 1.1, 1.9);
            } else if (lines === 2) {
                for (const side of [-1, 1]) {
                    frame(origin, shoreY + 0.018, spread, 0, side);
                    stroke([0, 0, 0.22, 0.09, 0.38, 0.32, 1, 0.34], GOLD, 1.55, 0.011, 0.025, 1.65, 0.9);
                    stroke([0, 0, 0.17, -0.13, 0.46, -0.25, 0.91, -0.28], CORAL, 1.42, 0.01, 0.075, 1.5, 1);
                    stroke([0.19, 0.08, 0.47, 0.04, 0.65, 0.12, 0.88, 0.12], COPPER, 1.05, 0.005, 0.14, 1.4, 1.2);
                }
            } else {
                for (let i = 0; i < 3; i++) {
                    const depth = i * 0.235;
                    const reach = 1.13 - i * 0.19;
                    for (const side of [-1, 1]) {
                        frame(origin, shoreY + depth * spread, spread, 0, side);
                        stroke(
                            [0, -0.12, reach * 0.4, -0.12, reach * 0.82, 0.025, reach, 0.27],
                            i === 1 ? CORAL : GOLD,
                            1.52,
                            0.011 - i * 0.001,
                            i * 0.085,
                            1.9,
                            0.75,
                        );
                        stroke(
                            [0.15, -0.16, reach * 0.52, -0.17, reach * 0.76, -0.055, reach * 0.9, 0.055],
                            COPPER,
                            0.95,
                            0.0055,
                            0.08 + i * 0.085,
                            1.75,
                            1,
                        );
                    }
                }
            }
        } else if (kind === 'combo') {
            // The cascade is a succession of fragments from a single radiant.
            // Each one splits off later and flies farther down the open sky.
            writingPriority = 3;
            const fragments = bounded(Number(payload?.comboCount ?? payload?.combo) || 2, 2, 6) + 2;
            const away = shared.center.value.x < 0.5 ? 1 : -1;
            const width = Math.min(aspect * 0.24, 0.39);
            const x = away > 0 ? aspect * 0.65 : aspect * 0.35;
            frame(x, horizon + 0.38, 1, 0, away);
            for (let i = 0; i < fragments; i++) {
                const gap = i * 0.024;
                const dy = -0.11 - i * 0.017;
                const sx = width * i * 0.09;
                const sy = -gap + Math.sin(i * 2.4) * 0.026;
                const tipX = Math.min(width, sx + width * 0.41);
                stroke(
                    [sx, sy, sx + 0.025, sy - 0.017, tipX - 0.032, sy + dy * 0.68, tipX, sy + dy],
                    i % 3 ? GOLD : PEARL,
                    1.65,
                    i % 2 ? 0.007 : 0.009,
                    i * 0.135,
                    1.05 + i * 0.08,
                    4.6,
                );
                stroke(
                    [sx + 0.008, sy, sx + 0.033, sy - 0.012, tipX - 0.005, sy + dy * 0.56, tipX + 0.014, sy + dy],
                    CORAL,
                    1.1,
                    0.004,
                    0.04 + i * 0.135,
                    1.15 + i * 0.08,
                    7,
                );
            }
        } else if (kind === 'quad' || kind === 'twist') {
            if (r < 0.015) return;
            const twist = kind === 'twist';
            writingPriority = twist ? 3 : 4;
            const loops = twist ? 2 : 4;
            const strands = twist && Number(payload?.lineCount ?? payload?.lines) === 0 ? 1 : 3;
            for (let i = 0; i < loops; i++) {
                const angle = twist ? -0.06 + phase * 0.22 + i * Math.PI : 0.52 + phase * 0.6 + i * 1.42;
                frame(mx, my, r, angle);
                for (let j = 0; j < strands; j++) {
                    if (twist) {
                        // Two large, opposing spiral arms peel from the limb.
                        // The delayed, displaced strand shows the gas shearing.
                        const offset = j * 0.085;
                        stroke(
                            [0.22, 0.96, 0.88, 1.47 + offset, 1.76 + offset, 0.76, 1.6 + offset, -0.34],
                            j === 1 ? GOLD : CORAL,
                            j === 1 ? 1.55 : 1.18,
                            0.012 - j * 0.002,
                            j * 0.027,
                            1.65,
                            0.56,
                        );
                        stroke(
                            [1.6 + offset, -0.34, 1.52 + offset, -0.96, 1.17, -1.19 - offset,
                                1.06, -Math.min(1.59, (0.98 - my) / r - 0.12)],
                            j === 1 ? CORAL : COPPER,
                            1.12,
                            0.009 - j * 0.0015,
                            0.23 + j * 0.027,
                            1.65,
                            1.12,
                        );
                    } else {
                        const lift = 1.56 - j * 0.07;
                        stroke(
                            [0.98, -0.19, lift + 0.06, -0.67, lift, 0.68, 0.91, 0.4 - j * 0.025],
                            j === 1 ? GOLD : CORAL,
                            j === 1 ? 0.82 : 0.56,
                            0.0041 - j * 0.00055,
                            i * 0.038 + j * 0.044,
                            2.0,
                            0.85,
                        );
                    }
                }
            }
        } else if (kind === 'b2b') {
            // Project the live crater through the same camera basis as the world.
            writingPriority = 4;
            const az = shared.volcanoAz.value;
            const el = shared.volcanoHeight.value * 0.84;
            const summit = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
            const facing = Math.max(0.01, summit.dot(shared.camFwd.value));
            frame(
                aspect * (0.5 + summit.dot(shared.camRight.value) / (2 * shared.tanHalf.value.x * facing)),
                0.5 + summit.dot(shared.camUp.value) / (2 * shared.tanHalf.value.y * facing),
                1,
            );
            const stones = capacity < 40 ? 19 : 33;
            for (let i = 0; i < stones; i++) {
                const scatter = (i * 0.618034 + phase) % 1;
                const dx = (scatter - 0.5) * 0.29 + 0.035;
                const dy = 0.075 + 0.13 * ((i * 0.754878 + phase) % 1);
                const lip = Math.sin(i * 4.7) * 0.004;
                stroke(
                    [lip, 0, dx * 0.21, dy, dx * 0.64, dy * 1.09, dx, -Math.abs(dx) * 0.23],
                    i % 3 ? COPPER : GOLD,
                    1.52 + (i % 3) * 0.17,
                    0.005 + (i % 4) * 0.0014,
                    ((i * 0.38196) % 1) * 0.51,
                    1.25 + (i % 6) * 0.145,
                    i % 4 ? -49 : -21,
                );
            }
        } else if (kind === 'levelUp') {
            writingPriority = 4;
            // A bank of light pillars rises from the reflection into the sky.
            for (let i = 0; i < 8; i++) {
                const v = i / 7;
                const dx = (v - 0.5) * Math.min(aspect * 0.34, 0.35);
                const dy = (0.115 + Math.sin(v * Math.PI) * 0.12) * (0.78 + 0.22 * Math.sin(i * 8.1 + phase));
                frame(mx + dx, horizon + 0.012, 1);
                stroke(
                    [0, 0, 0.003, dy * 0.3, 0.002, dy * 0.74, 0, dy],
                    i % 3 ? CORAL : GOLD,
                    0.58,
                    0.009 + (i % 3) * 0.002,
                    i * 0.05,
                    2.9,
                    0.6,
                );
                stroke(
                    [0, -0.01, -0.003, -dy * 0.12, 0.004, -dy * 0.27, 0.002, -dy * 0.4],
                    COPPER,
                    0.44,
                    0.0035,
                    0.15 + i * 0.05,
                    2.1,
                    0.7,
                );
            }
        } else if (kind === 'perfectClear') {
            if (r < 0.015) return;
            writingPriority = 6;
            const shadowX = shared.shadow.value.x;
            const nudgedShadow = (shadowX < 0 ? -1 : 1) * Math.max(Math.abs(shadowX), DIAMOND_REACH);
            const angle = Math.atan2(-shared.shadow.value.y, -nudgedShadow);
            // Pearl beads along the illuminated limb, then a single diamond
            // star with long tapered diffraction rays and fine coronal plumes.
            for (let i = 0; i < 13; i++) {
                const a = angle + (i - 6) * 0.165;
                frame(mx, my, r, a);
                const reach = 1.29 + 0.18 * Math.sin(i * 4.1) + 0.26 * Math.cos((i - 6) * 0.28);
                stroke(
                    [1, 0, 1.12, -0.015, reach * 0.92, 0.09, reach, 0.18],
                    i % 3 ? GOLD : PEARL,
                    0.96,
                    0.0042,
                    0.025 * Math.abs(i - 6),
                    2.75,
                    1.35,
                );
            }
            const bx = mx + Math.cos(angle) * r * 1.012;
            const by = my + Math.sin(angle) * r * 1.012;
            for (let i = 0; i < 6; i++) {
                frame(bx, by, r, 0.23 + i * (Math.PI / 3));
                const ray = i % 3 === 0 ? 1.35 : 0.54;
                stroke(
                    [-0.012, 0, ray * 0.11, 0, ray * 0.64, 0, ray, 0],
                    PEARL,
                    1.2,
                    i % 3 === 0 ? 0.0055 : 0.0038,
                    0.035,
                    2.55,
                    1.75,
                );
            }
        } else if (kind === 'garbage' || kind === 'counter') {
            writingPriority = 2;
            const counter = kind === 'counter';
            const faults = bounded(Number(payload?.linesInserted ?? payload?.linesCanceled) || 2, 1, 4);
            frame(shore, shoreY, Math.min(0.3, aspect * 0.35));
            for (let i = 0; i < faults; i++) {
                const y = i * 0.13;
                const tip = (i % 2 ? -1 : 1) * (0.65 + i * 0.12);
                const ridge = y + 0.16;
                stroke(
                    counter ? [tip, ridge, tip * 0.64, ridge, tip * 0.48, y, 0, y]
                        : [0, y, tip * 0.27, y, tip * 0.35, ridge, tip * 0.58, ridge],
                    counter ? PEARL : GARNET,
                    1.55,
                    0.011,
                    i * 0.05,
                    1.58,
                    1.0,
                );
                if (!counter) {
                    stroke(
                        [tip * 0.58, ridge, tip * 0.7, ridge, tip * 0.82, y + 0.03, tip, y + 0.04],
                        COPPER,
                        1.21,
                        0.007,
                        0.13 + i * 0.05,
                        1.22,
                        1.85,
                    );
                    stroke(
                        [tip * 0.4, ridge - 0.013, tip * 0.57, ridge + 0.03,
                            tip * 0.47, ridge + 0.14, tip * 0.67, ridge + 0.19],
                        CORAL,
                        1.05,
                        0.0055,
                        0.21 + i * 0.05,
                        1.44,
                        1.3,
                    );
                } else {
                    stroke(
                        [tip * 0.89, ridge + 0.15, tip * 0.71, ridge + 0.02, tip * 0.51, ridge, tip * 0.16, y + 0.015],
                        GOLD,
                        0.94,
                        0.005,
                        0.09 + i * 0.05,
                        1.42,
                        1.6,
                    );
                }
            }
        } else if (kind === 'gameOver') {
            writingPriority = 5;
            for (let i = 0; i < 17; i++) {
                const x = mx + (((i * 0.618034) % 1) - 0.5) * Math.min(0.84, aspect * 0.85);
                const y = horizon + 0.15 + 0.28 * ((i * 0.754878 + phase) % 1);
                frame(x, y, 1);
                stroke(
                    [0, 0, -0.005, -0.043, -0.059, -0.09, -0.096 - (i % 3) * 0.02, -0.153],
                    i % 3 ? ASH : COPPER,
                    1.25,
                    0.006 + (i % 3) * 0.0008,
                    ((i * 0.47) % 1) * 0.8,
                    2.4 + (i % 4) * 0.35,
                    i % 3 ? 4 : -20,
                );
            }
        }
    }

    function update(dt, flash) {
        clock.value += dt;
        light.value = flash;
        for (let i = count - 1; i >= 0; i--) {
            if (ends[i] > clock.value) continue;
            count--;
            if (i !== count) {
                data.copyWithin(i * STRIDE, count * STRIDE, (count + 1) * STRIDE);
                ends[i] = ends[count];
                scales[i] = scales[count];
                priorities[i] = priorities[count];
            }
            dirty = true;
        }
        geometry.instanceCount = count;
        object.visible = count > 0;
        if (dirty && count) buffer.needsUpdate = true;
        dirty = false;
        if (!count) clock.value = 0;
    }
    function reset() {
        count = 0; serial = 0; dirty = false;
        update(0, 1);
    }
    return {
        object,
        cue,
        update,
        reset,
        get count() { return count; },
    };
}
