/**
 * Short-lived ionised gas. Each event draws its path into a fixed strip once. The vertex shader
 * opens the strip from its source while a pulse of light travels along its fibrous edge. At
 * rest a single collapsed triangle pair keeps the pipeline warm. The shells reuse the gas textures.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, If, abs, attribute, clamp, exp, float, floor, int, max, mix, positionGeometry, sin, smoothstep,
    step, uniformArray, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { STARFIRE, TAU, tideStarPosition } from './aether-tides-core.js';
import { flashScale } from '../../utils/photosensitivity.js';

const SLOTS = 20;
const ROWS = 3;
const ICE = [0.12, 0.72, 1.0];
const COPPER = [1, 0.29, 0.085];

function createMaterial(tide, picture, rows, noise, clouds, plateMix) {
    const table = uniformArray(rows, 'vec4');
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Most filaments add light with alpha zero. A shell also absorbs some of the light behind it.
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
        fog: false,
    });
    material.forceSinglePass = true;
    material.name = 'Aether Tides — plasma filaments';
    const base = int(floor(positionGeometry.z.add(0.5))).mul(ROWS);
    const timing = table.element(base);
    const ink = table.element(base.add(1));
    const shape = table.element(base.add(2));
    const age = tide.time.add(tide.ahead).sub(timing.z).div(max(timing.w, 0.001));
    const t = clamp(age, 0, 1);
    const live = step(0, age).mul(step(age, 1));
    const s = positionGeometry.x;
    const edge = positionGeometry.y;
    const curve = attribute('tidePath', 'vec4');
    const swell = mix(1, smoothstep(-0.09, 0.39, t), ink.w);
    const centre = mix(timing.xy, curve.xy, swell);
    const width = mix(1, swell, step(shape.x, -0.001));
    const point = centre.add(curve.zw.mul(edge).mul(live).mul(width));
    const framed = point.sub(picture.frame.xy).mul(picture.frame.z);
    material.vertexNode = vec4(framed.x.div(tide.screen.x), framed.y.div(tide.screen.y).negate(), 0, 1);
    const phase = varying(vec4(s, edge, t, shape.w));
    const pulse = varying(vec3(t.div(max(abs(shape.x), 0.001)), shape.y, step(shape.x, -0.001)));
    const rgb = varying(ink.xyz.mul(shape.z).mul(live).mul(float(1).sub(picture.hush.mul(0.65))));
    // Interpolate metres across the strip, then divide by its interpolated width. Interpolating
    // -1/+1 directly makes a tapered trapezoid kink at the diagonal between its triangles.
    const extent = curve.zw.length();
    const lateral = varying(vec2(edge.mul(extent), extent));
    // A brighter leading edge splits into two fine fibres around an uneven, translucent sheet.
    // Vary the spacing down the strip to keep a shell's edge from reading as a drawn line.
    const thread = sin(phase.x.mul(18).add(phase.w).sub(phase.z.mul(3)));
    const fold = sin(phase.x.mul(41).sub(phase.w).add(phase.z.mul(2))).mul(0.105).add(thread.mul(0.22));
    const across = phase.y.sub(fold);
    const core = exp(across.mul(across).mul(-54));
    const side = abs(across.add(thread.mul(0.15)).sub(0.48));
    const filament = exp(side.mul(side).mul(-88)).mul(0.30);
    const haze = exp(across.mul(across).mul(-4)).mul(0.22);
    const passed = pulse.x.sub(phase.x);
    const head = exp(passed.mul(passed).mul(-95));
    const tail = smoothstep(-0.09, 0.06, passed).mul(exp(max(passed, 0).mul(pulse.y.negate())));
    const taper = smoothstep(0, 0.07, phase.x).mul(float(1).sub(smoothstep(0.87, 1, phase.x)));
    const fade = float(1).sub(smoothstep(0.44, 1, phase.z));
    const strokes = core.add(filament).add(haze).mul(head.mul(0.65).add(tail));
    material.outputNode = Fn(() => {
        const out = vec4(0).toVar();
        If(pulse.z.greaterThan(0.5), () => {
            // Look through a thin, expanding gas shell. Along each sightline the wall is
            // brightest edge-on. Turbulence breaks its contact surface into overlapping folds.
            const u = phase.x.toVar();
            const v = clamp(lateral.x.div(max(lateral.y, 0.0001)), -1, 1).toVar();
            const uv = vec2(u.mul(0.78).sub(phase.z.mul(0.06)), v.mul(0.31)).add(phase.w.mul(0.13)).toVar();
            const broad = noise.sample(uv).level(0.5).toVar();
            const grain = noise.sample(uv.mul(vec2(1.35, 3.2)).add(broad.xy.mul(0.33))).level(0.5).toVar();
            const shell = abs(v).add(broad.x.sub(0.5).mul(0.57)).add(grain.y.sub(0.5).mul(0.21)).toVar();
            const warm = step(rgb.b, rgb.r).toVar();
            // Project a torn fold of the same interstellar bank into each lobe. Its local
            // contrast, sampled across the bank, picks the fibres facing the star; the quieter
            // side of each ridge absorbs a trace of the sky instead of glowing uniformly.
            const gas = grain.z.mul(0.55).add(broad.y.mul(0.45)).toVar();
            const relief = abs(grain.z.sub(broad.x)).mul(1.8).toVar();
            If(plateMix.greaterThan(0.001), () => {
                const at = vec2(
                    mix(0.045, 0.5, warm).add(u.mul(0.39)).add(v.mul(0.022)),
                    mix(float(0.06).add(u.mul(0.48)), float(0.84).sub(u.mul(0.44)), warm).add(v.mul(0.2)),
                ).add(broad.xy.sub(0.5).mul(0.041)).toVar();
                const sample = clouds.sample(at).level(1).rgb.toVar();
                const neighbour = clouds.sample(at.add(vec2(0.0027, -0.0043))).level(2.2).rgb.toVar();
                gas.assign(max(sample.r, max(sample.g, sample.b)));
                relief.assign(clamp(gas.sub(max(neighbour.r, max(neighbour.g, neighbour.b))).mul(3.2), 0, 1));
            });
            const wall = shell.sub(0.6).toVar();
            const edgeLight = exp(wall.mul(wall).mul(-86)).toVar();
            const matter = smoothstep(0.18, 0.86, gas).toVar();
            const seams = relief.mul(matter).toVar();
            const lip = edgeLight.mul(smoothstep(0.34, 0.82, gas.add(grain.x.sub(0.5).mul(0.55)))).toVar();
            const root = smoothstep(0.015, 0.3, u);
            const tip = float(1).sub(smoothstep(0.78, 1, u));
            const outer = float(1).sub(smoothstep(0.68, 0.96, shell));
            const opened = smoothstep(-0.12, 0.16, pulse.x.sub(u));
            const front = root.mul(tip).mul(outer).mul(opened).mul(fade)
                .toVar();
            const gain = max(rgb.r, max(rgb.g, rgb.b)).toVar();
            const shade = mix(vec3(0.16, 0.018, 0.39), vec3(0.53, 0.018, 0.063), warm).mul(gain);
            const pearl = mix(vec3(0.65, 0.86, 1), vec3(1, 0.76, 0.49), warm).mul(gain);
            const body = shade.mul(matter.mul(0.34));
            const fibres = rgb.mul(matter.mul(matter).mul(0.46).add(lip.mul(0.46)));
            const glints = pearl.mul(seams.mul(0.65).add(lip.mul(relief).mul(0.9)));
            const absorption = matter.mul(0.34).add(seams.mul(0.12)).add(lip.mul(0.13));
            out.assign(vec4(body.add(fibres).add(glints).mul(front), absorption.mul(front)));
        }).Else(() => {
            out.assign(vec4(rgb.mul(strokes).mul(taper).mul(fade)
                .mul(float(1).sub(smoothstep(0.77, 1, abs(phase.y)))), 0));
        });
        return out;
    })();

    return material;
}

export function createTideRibbons({
    tide, picture, tier, noise, clouds, plateMix,
}) {
    const segments = tier.sparkles < 300 ? 24 : 40;
    const vertices = (segments + 1) * 2;
    const domain = new Float32Array(SLOTS * vertices * 3);
    const path = new THREE.BufferAttribute(new Float32Array(SLOTS * vertices * 4), 4);
    path.setUsage(THREE.DynamicDrawUsage);
    const indices = new Uint16Array(SLOTS * segments * 6);
    for (let slot = 0; slot < SLOTS; slot++) {
        for (let j = 0; j <= segments; j++) {
            const index = slot * vertices + j * 2;
            domain.set([j / segments, -1, slot, j / segments, 1, slot], index * 3);
            if (j < segments) {
                indices.set(
                    [index, index + 1, index + 2, index + 1, index + 3, index + 2],
                    (slot * segments + j) * 6,
                );
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(domain, 3));
    geometry.setAttribute('tidePath', path);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const rows = Array.from({ length: SLOTS * ROWS }, () => new THREE.Vector4());
    const ends = new Float64Array(SLOTS);
    const priority = new Uint8Array(SLOTS);
    const samples = new Float32Array((segments + 1) * 2);
    const widths = new Float32Array(segments + 1);
    let highest = -1;

    const material = createMaterial(tide, picture, rows, noise, clouds, plateMix);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.renderOrder = 9;
    mesh.frustumCulled = false;

    function reset() {
        highest = -1;
        ends.fill(-Infinity);
        for (let i = 0; i < SLOTS; i++) rows[i * ROWS].set(0, 0, -1e6, 1);
        geometry.setDrawRange(0, 6);
    }
    reset();

    // Coordinates are sampled once at emission, including on the no-solver backend. Lower
    // importance traces (drops) cannot overwrite a major event still on screen in multiplayer.
    function write({
        x, y, at, life, color, width, gain = 1, expansion = 0, draw = 0.48, tail = 0.65, rank = 1,
    }, sample) {
        let slot = -1;
        for (let i = 0; i < SLOTS; i++) {
            if (ends[i] <= tide.time.value) { slot = i; break; }
            if (priority[i] <= rank && (slot < 0 || priority[i] < priority[slot]
                || (priority[i] === priority[slot] && ends[i] < ends[slot]))) slot = i;
        }
        if (slot < 0) return;
        highest = Math.max(highest, slot);
        ends[slot] = at + life;
        priority[slot] = rank;
        rows[slot * ROWS].set(x, y, at, life);
        rows[slot * ROWS + 1].set(color[0], color[1], color[2], expansion);
        rows[slot * ROWS + 2].set(draw, tail, gain * (0.55 + 0.45 * flashScale()), (slot * 2.4 + at * 0.7) % TAU);
        for (let i = 0; i <= segments; i++) widths[i] = sample(i / segments, samples, i * 2) ?? 1;
        for (let i = 0; i <= segments; i++) {
            const here = i * 2;
            const prev = Math.max(0, here - 2);
            const next = Math.min(segments * 2, here + 2);
            const dx = samples[next] - samples[prev];
            const dy = samples[next + 1] - samples[prev + 1];
            const thickness = width * widths[i] * (0.36 + 0.64 * Math.sin(Math.PI * (i / segments)));
            const size = thickness / Math.max(1e-5, Math.hypot(dx, dy));
            const vertex = slot * vertices + i * 2;
            path.setXYZW(vertex, samples[here], samples[here + 1], -dy * size, dx * size);
            path.setXYZW(vertex + 1, samples[here], samples[here + 1], -dy * size, dx * size);
        }
        const start = slot * vertices * 4;
        const length = vertices * 4;
        // Several events can arrive before a draw. Keep a single dirty span, also while the
        // playground is showing another part and three has no reason to upload this buffer.
        const dirty = path.updateRanges[0];
        if (dirty) {
            const end = Math.max(dirty.start + dirty.count, start + length);
            dirty.start = Math.min(dirty.start, start);
            dirty.count = end - dirty.start;
        } else path.addUpdateRange(start, length);
        path.needsUpdate = true;
        geometry.setDrawRange(0, (highest + 1) * segments * 6);
    }

    function spiral({
        x, y, at, color, radius, angle, turn, inward = false, gain = 1.4,
    }) {
        write(
            {
                x, y, at, color, life: 1.65, width: 0.029, gain, expansion: inward ? 0 : 0.3,
            },
            (s, out, i) => {
                const k = inward ? 1 - s : s;
                const r = radius * (0.08 + 0.92 * k);
                const a = angle + turn * k;
                out[i] = x + r * Math.cos(a);
                out[i + 1] = y + r * Math.sin(a) * 0.77;
            },
        );
    }

    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    return {
        mesh,
        reset,
        update(time) {
            while (highest >= 0 && ends[highest] <= time) highest--;
            geometry.setDrawRange(0, Math.max(6, (highest + 1) * segments * 6));
        },
        drop(x, y, at, color, scale) {
            for (let k = 0; k < 2; k++) {
                write({
                    x,
                    y,
                    at,
                    color,
                    life: 0.69,
                    width: k ? 0.014 : 0.028,
                    gain: k ? 0.8 : 2,
                    draw: 0.19,
                    tail: 0.55,
                    rank: 0,
                }, (s, out, i) => {
                    const remaining = 1 - s;
                    out[i] = x + (k ? 0.055 : -0.023) * remaining * remaining * scale;
                    out[i + 1] = y - remaining * (k ? 0.48 : 0.8) * scale;
                });
            }
        },
        twist(x, y, at, color, radius, sign) {
            spiral({
                x, y, at, color, radius, angle: 1.25 + (at % 2), turn: 5 * sign,
            });
            spiral({
                x,
                y,
                at: at + 0.07,
                color: ICE,
                radius: radius * 0.87,
                angle: Math.PI + 1.25 + (at % 2),
                turn: 5 * sign,
                gain: 1.1,
            });
        },
        accrete(x, y, at, color, stepCount, scale) {
            spiral({
                x,
                y,
                at,
                color,
                radius: (0.22 + Math.min(stepCount, 8) * 0.025) * scale,
                angle: stepCount * 2.4,
                turn: 7,
                inward: true,
                gain: 1.15,
            });
        },
        cascade(x, y, at, color, side, depth, scale) {
            write({
                x, y, at, color, life: 0.98, width: 0.025, gain: 1.6, draw: 0.39,
            }, (s, out, i) => {
                out[i] = x + side * s * (0.48 + Math.min(4, depth) * 0.095) * scale;
                out[i + 1] = y - s * (0.14 + 0.085 * Math.sin(s * 7 - 0.9)) * scale;
            });
        },
        jets(x, y, at, scale) {
            const angle = 0.52 + Math.sin(at * 0.19) * 0.22;
            for (const side of [-1, 1]) {
                write({
                    x,
                    y,
                    at,
                    color: side < 0 ? ICE : STARFIRE,
                    life: 1.95,
                    width: 0.046,
                    gain: 2.7,
                    draw: 0.33,
                    rank: 2,
                }, (s, out, i) => {
                    const run = side * s * 0.85 * scale;
                    const curl = side * (Math.sin(s * 11) * 0.04 + 0.055 * s) * s * scale;
                    out[i] = x + Math.cos(angle) * run - Math.sin(angle) * curl;
                    out[i + 1] = y + Math.sin(angle) * run + Math.cos(angle) * curl;
                });
            }
        },
        bridge(at, aspect, scale) {
            tideStarPosition(0, at, aspect, a);
            tideStarPosition(1, at + 0.7, aspect, b);
            for (let k = 0; k < 2; k++) {
                write(
                    {
                        x: a.x,
                        y: a.y,
                        at: at + k * 0.12,
                        color: k ? COPPER : STARFIRE,
                        life: 2.45,
                        width: k ? 0.022 : 0.035,
                        gain: k ? 1.15 : 1.7,
                        draw: 0.47,
                        tail: 1.9,
                        rank: 2,
                    },
                    (s, out, i) => {
                        const bow = Math.sin(s * Math.PI) * scale;
                        out[i] = a.x + (b.x - a.x) * s + bow * (0.22 + k * 0.04);
                        out[i + 1] = a.y + (b.y - a.y) * s - bow * (0.27 + k * 0.1 + Math.sin(s * 7) * 0.06);
                    },
                );
            }
        },
        shells(at, aspect, scale) {
            // Two connected lobes on the tangent to each star's sky position. A tall frame
            // gives them a horizontal axis in its free strip above or below the board.
            for (let star = 0; star < 2; star++) {
                tideStarPosition(star, at, aspect, a);
                const stripAngle = star ? -0.12 : 0.09;
                const angle = aspect < 0.72 ? stripAngle : Math.atan2(-a.x, a.y);
                const dx = Math.cos(angle);
                const dy = Math.sin(angle);
                for (const side of [-1, 1]) {
                    const nx = side * dx;
                    const ny = side * dy;
                    const roomX = (aspect - a.x * Math.sign(nx)) / Math.max(0.001, Math.abs(nx));
                    const roomY = (1 - a.y * Math.sign(ny)) / Math.max(0.001, Math.abs(ny));
                    const extent = Math.min(star ? 1.13 : 1.38, roomX, roomY) * (0.81 + 0.17 * scale);
                    const breadth = Math.min(aspect < 0.72 ? 0.16 : 0.38, extent * 0.49);
                    const shell = star ? COPPER : [0.026, 0.47, 1];
                    write({
                        x: a.x,
                        y: a.y,
                        at: at + star * 0.25,
                        color: shell,
                        life: 4.85 - 0.2 * star,
                        width: breadth,
                        gain: 1.55,
                        // A negative reveal time selects the translucent shell in this material.
                        draw: -0.22,
                        expansion: scale,
                        rank: 3,
                    }, (s, out, i) => {
                        const curl = breadth * (0.32 * Math.sin(s * 4.1) + 0.065 * Math.sin(s * 10.4)) * s;
                        out[i] = a.x + nx * extent * s - ny * curl;
                        out[i + 1] = a.y + ny * extent * s + nx * curl;
                        return 2.1 * s ** 0.9 * (1.01 - s) ** 0.29;
                    });
                }
            }
        },
        level(at, aspect, palette, scale) {
            for (let star = 0; star < 2; star++) {
                tideStarPosition(star, at, aspect, a);
                for (let k = 0; k < 3; k++) {
                    write({
                        x: a.x,
                        y: a.y,
                        at: at + k * 0.13,
                        color: [palette.gasA, palette.gasB, palette.gasC][k],
                        life: 3.1,
                        width: 0.033,
                        gain: 1.25,
                        draw: 0.63,
                        tail: 0.64,
                    }, (s, out, i) => {
                        const dir = star ? -1 : 1;
                        out[i] = a.x + dir * s * Math.min(1.4, aspect * 1.05) * scale;
                        out[i + 1] = a.y + dir * (Math.sin(s * 4.8) * (0.11 + 0.065 * k)
                            - s * (0.34 - 0.11 * k)) * scale;
                    });
                }
            }
        },
        settle(at, aspect, scale) {
            for (let star = 0; star < 2; star++) {
                tideStarPosition(star, at, aspect, a);
                write({
                    x: a.x,
                    y: a.y,
                    at,
                    color: star ? COPPER : ICE,
                    life: 4.8,
                    width: 0.046,
                    gain: 0.8,
                    draw: 0.7,
                    tail: 1.8,
                }, (s, out, i) => {
                    const u = 1 - s;
                    out[i] = a.x + (star ? -1 : 1) * (0.44 * u + 0.095 * Math.sin(u * 7)) * scale;
                    out[i + 1] = a.y + (star ? -1 : 1) * u * u * 0.46 * scale;
                });
            }
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
