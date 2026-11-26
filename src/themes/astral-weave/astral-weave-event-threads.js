/**
 * Short lengths of embroidery drawn into the space beside the loom. The atlas
 * holds each stitch's centreline and tangent. Instances name a stitch and its
 * seat, so a perfect clear and an ordinary lock share one prewarmed pipeline.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, attribute, clamp, exp, float, fract, fwidth, ivec2, mix, positionGeometry, smoothstep, textureLoad,
    uniform, uv, vec2, vec3, vec4, vertexStage,
} from 'three/tsl';
import { awFxMaterial, awRibbonClip, awThreadGeometry } from './astral-weave-tsl.js';
import { cardUnion } from './astral-weave-composition.js';
import { uploadUsed } from '../shared/instance-upload.js';
import { flashScale } from '../../utils/photosensitivity.js';

const TAU = Math.PI * 2;
const { sin, cos, PI } = Math;
const bounded = (x, low, high) => Math.max(low, Math.min(high, x));
const STITCHES = {
    shuttle: (t) => [2 * t - 1, sin(t * PI) * sin(t * TAU)],
    fall: (t) => [0.62 * (1 - t) ** 2 - 0.17 * sin(PI * t), 1 - 2 * t],
    whisker: (t) => [2 * t - 1, 0.85 * sin(PI * t) - 0.24 * sin(TAU * t)],
    feather: (t) => [2 * t - 1, 0.82 * sin(PI * t) * (1 - cos(PI * t))],
    helix: (t) => [sin(TAU * t * 1.5), t * 2 - 1],
    chain: (t) => [sin(TAU * t), sin(TAU * 2 * t)],
    spiral: (t) => {
        const radius = 0.06 + t * 0.94;
        return [cos(t * TAU * 1.78) * radius, sin(t * TAU * 1.78) * radius];
    },
    petal: (t) => [Math.max(0, sin(t * PI)) ** 1.25, sin(t * TAU) * (0.12 + 0.64 * sin(t * PI))],
    quill: (t) => [t, sin(PI * t) * (0.83 - t * 0.58) - sin(TAU * t) * 0.16],
    arc: (t) => [cos(PI * (0.10 + 0.82 * t)), sin(PI * (0.10 + 0.82 * t))],
    knot: (t) => [(sin(TAU * t) + 2 * sin(2 * TAU * t)) / 3, (cos(TAU * t) - 2 * cos(2 * TAU * t)) / 3],
    looseEnd: (t) => [sin(t * PI * 2.9) * (0.17 + 0.32 * t) + t * 0.31, 1 - 2 * t],
    blossom: (t) => {
        // Five pointed sepals share a scalloped, slightly twisted outer hem.
        const a = t * TAU;
        const lobe = cos(a * 5) * 0.5 + 0.5;
        const radius = 0.37 + 0.62 * lobe ** 1.68;
        const angle = a + 0.085 * sin(a * 5);
        return [cos(angle) * radius, sin(angle) * radius];
    },
    wing: (t) => [2 * t - 1, 0.61 * sin(t * PI) - 0.34 * sin(t * TAU) + 0.36 * t],
};
const stitchNames = Object.keys(STITCHES);
const INK = {
    pink: [2.5, 0.12, 0.57],
    cyan: [0.05, 1.65, 2.4],
    gold: [2.95, 1.14, 0.19],
    ice: [0.57, 1.45, 2.65],
    violet: [1.12, 0.33, 2.55],
    pearl: [2.1, 1.48, 1.17],
    rust: [2.28, 0.31, 0.095],
    silver: [0.92, 1.36, 1.57],
    mauve: [0.59, 0.22, 0.47],
};
const TIER = {
    Minimal: [24, 24],
    Low: [32, 28],
    Medium: [48, 40],
    High: [64, 56],
    Ultra: [72, 64],
    Extreme: [80, 64],
};
const STRIDE = 16;

function stitchAtlas(segments) {
    const width = segments + 1;
    const data = new Float32Array(width * stitchNames.length * 4);
    stitchNames.forEach((name, row) => {
        const sample = STITCHES[name];
        for (let j = 0; j <= segments; j++) {
            const t = j / segments;
            const [x, y] = sample(t);
            const [prevX, prevY] = sample(Math.max(0, t - 0.002));
            const [nextX, nextY] = sample(Math.min(1, t + 0.002));
            data.set([x, y, nextX - prevX, nextY - prevY], (row * width + j) * 4);
        }
    });
    const atlas = new THREE.DataTexture(data, width, stitchNames.length, THREE.RGBAFormat, THREE.FloatType);
    atlas.name = 'astral-weave-stitch-atlas';
    atlas.needsUpdate = true;
    return atlas;
}

/** The two clear windows beside the live cards and HUD, in hoop-local units. */
function openBays(layout, aspect, loom) {
    const card = cardUnion(layout);
    const hud = layout?.cardCount > 0 ? layout.hud : null;
    const frameX = (x) => ((x - 0.5) * aspect - loom.cx) / loom.radius;
    const frameY = (y) => (0.5 - y - loom.cy) / loom.radius;
    const width = frameX(1) - frameX(0);
    const left = frameX(Math.min(card?.x0 ?? 0.38, hud?.x0 ?? 1));
    const right = frameX(Math.max(card?.x1 ?? 0.62, hud?.x1 ?? 0));
    const bottom = frameY(0.97);
    const top = frameY(0.03);
    return [-1, 1].map((side) => {
        const x0 = side < 0 ? frameX(0.02) : right + 0.035;
        const x1 = side < 0 ? left - 0.035 : frameX(0.98);
        if (x1 - x0 > 0.22) {
            return {
                side, x0, x1, bottom, top, vertical: false,
            };
        }
        // On compact screens, two slim stages above and below the cards.
        const y0 = side < 0 ? frameY(card?.y0 ?? 0.25) + 0.025 : bottom;
        const y1 = side < 0 ? top : frameY(card?.y1 ?? 0.75) - 0.025;
        return {
            side,
            x0: frameX(0.5) - width * 0.37,
            x1: frameX(0.5) + width * 0.37,
            bottom: y0,
            top: y1,
            vertical: true,
        };
    });
}

export function createEventThreads(shared, quality = 'High') {
    const [capacity, segments] = TIER[quality] ?? TIER.High;
    const atlas = stitchAtlas(segments);
    const geometry = awThreadGeometry(1, segments, 179);
    geometry.deleteAttribute('aThread');
    geometry.instanceCount = 0;
    const data = new Float32Array(capacity * STRIDE);
    const ends = new Float64Array(capacity);
    const priority = new Uint8Array(capacity);
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE).setUsage(THREE.DynamicDrawUsage);
    ['aStitchPose', 'aStitchAxis', 'aStitchTime', 'aStitchInk'].forEach((key, i) => {
        geometry.setAttribute(key, new THREE.InterleavedBufferAttribute(buffer, 4, i * 4));
    });
    const pose = attribute('aStitchPose', 'vec4');
    const axis = attribute('aStitchAxis', 'vec4');
    const life = attribute('aStitchTime', 'vec4');
    const ink = attribute('aStitchInk', 'vec4');
    const motion = uniform(1);
    const light = uniform(1);
    const material = awFxMaterial('astral-weave-event-threads');
    material.premultipliedAlpha = true;
    material.vertexNode = Fn(() => {
        const index = positionGeometry.x.mul(segments).add(0.5).floor().toInt();
        const stitch = textureLoad(atlas, ivec2(index, pose.w.add(0.5).toInt())).toVar();
        const dir = axis.xy.toVar();
        const up = vec2(dir.y.negate(), dir.x).toVar();
        const xAxis = dir.mul(axis.z).toVar();
        const yAxis = up.mul(axis.w).toVar();
        const point = pose.xy.add(xAxis.mul(stitch.x)).add(yAxis.mul(stitch.y)).toVar();
        const tangent = xAxis.mul(stitch.z).add(yAxis.mul(stitch.w));
        const width = shared.uPxScale.mul(life.z);
        const next = vec3(point.add(tangent), pose.z);
        return awRibbonClip(vec3(point, pose.z), next, positionGeometry.y, width, shared.uViewport);
    })();
    material.outputNode = Fn(() => {
        const u = clamp(uv().x, 0, 1).toVar();
        const across = clamp(uv().y.mul(2).sub(1).abs(), 0, 1).toVar();
        const age = shared.uTime.sub(vertexStage(life.x)).mul(vertexStage(life.y)).toVar();
        const advance = mix(float(1.03), clamp(age.mul(2.95), -0.1, 1.3), motion).toVar();
        const behind = advance.sub(u).toVar();
        const taper = smoothstep(-0.025, 0.025, behind);
        const afterglow = float(1).sub(smoothstep(0.42, 1, age));
        const trim = vertexStage(life.w).toVar();
        // A loose end slips out of its peg; its trailing end follows the
        // lead down the side of the loom, leaving that peg dark again.
        const slip = float(1).sub(smoothstep(0.13, 0.75, age.mul(1.53).sub(u)));
        const coda = clamp(trim.negate(), 0, 1).mul(motion);
        const on = smoothstep(0, 0.105, age).mul(afterglow).mul(taper).mul(mix(float(1), slip, coda))
            .toVar();
        const core = exp(across.mul(across).mul(-15)).toVar();
        const silk = exp(across.mul(across).mul(-3.2)).sub(0.041).max(0);
        const tip = exp(behind.mul(behind).mul(-260)).mul(motion).toVar();
        const tint = vertexStage(ink).toVar();
        // Gold couching tacks a finer wire down at intervals. The thinnest
        // strokes resolve into an average under minification on a phone.
        const couch = clamp(trim, 0, 1).toVar();
        const spacing = u.mul(13.0).add(couch.mul(0.71)).toVar();
        const distance = fract(spacing).sub(0.5).abs().toVar();
        const aa = fwidth(spacing).clamp(0.025, 0.47).toVar();
        const tack = float(1).sub(smoothstep(float(0.21).sub(aa), float(0.21).add(aa), distance));
        const stitches = mix(float(1), tack.mul(0.95).add(0.05), couch).toVar();
        const glint = u.sub(0.935).mul(72).pow2().negate()
            .exp()
            .mul(couch);
        const shine = core.mul(0.74).add(silk.mul(0.28)).mul(behind.max(0).mul(-0.34).exp()).mul(stitches);
        const radiance = tint.rgb.mul(shine).add(vec3(2.3, 1.77, 1.43).mul(core).mul(tip.add(glint)));
        return vec4(radiance.mul(tint.a).mul(on).mul(light).mul(shared.uFade), 0);
    })();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 27;

    let bays = openBays(null, 16 / 9, { radius: 0.58, cx: 0, cy: 0 });
    let sequence = 0;
    let occupied = 0;
    let dirty = false;
    let endingUntil = -Infinity;
    const upload = [buffer];

    function put(time, rank, origin, shape, x, y, w, h, rot, hue, power, delay, seconds, thickness = 4, couch = 0) {
        let slot = occupied;
        if (slot === capacity) {
            // Rare flourishes survive a flurry of locks; late-stage strokes
            // can cool into the next one once their embroidered figure has read.
            slot = -1;
            for (let i = 0; i < occupied; i++) {
                const remaining = ends[i] - time;
                if (remaining > 0 && (priority[i] > rank || (priority[i] === rank && remaining > 0.26))) continue;
                if (slot < 0 || ends[i] < ends[slot]) slot = i;
            }
            if (slot < 0) return;
        } else occupied++;
        const c = cos(rot);
        const s = sin(rot);
        const { side, scale, vertical } = origin;
        const ox = x * scale;
        const oy = y * scale;
        // A bay above or below the card turns its local outward axis vertical.
        const px = origin.x + (vertical ? oy : ox * side);
        const py = origin.y + (vertical ? ox * -side : oy);
        const dx = vertical ? s : c * side;
        const dy = vertical ? -c * side : s;
        const off = slot * STRIDE;
        data.set([px, py, 0.06, stitchNames.indexOf(shape), dx, dy, w * scale, h * scale * side,
            time + delay, 1 / seconds, thickness, couch, ...hue, power], off);
        ends[slot] = time + delay + seconds;
        priority[slot] = rank;
        dirty = true;
    }

    function seat(bay, y, radius) {
        const width = bay.x1 - bay.x0;
        const height = bay.top - bay.bottom;
        if (width < 0.075 || height < 0.075) return null;
        const scale = Math.min(radius, width * 0.46, height * 0.46);
        const x = bay.vertical ? (bay.x0 + bay.x1) * 0.5 : bay.side * Math.sqrt(Math.max(0.18, 1 - y * y));
        return {
            side: bay.side,
            vertical: bay.vertical,
            scale,
            x: bounded(x, bay.x0 + scale, bay.x1 - scale),
            y: bounded(y, bay.bottom + scale, bay.top - scale),
        };
    }

    function stage(time, rank, y, radius, which, draw) {
        const paint = (bay) => {
            const origin = seat(bay, y, radius);
            if (!origin) return false;
            draw((...args) => put(time, rank, origin, ...args), bay.side);
            return true;
        };
        if (which) {
            const preferred = which > 0 ? 1 : 0;
            if (!paint(bays[preferred])) paint(bays[1 - preferred]);
        } else {
            bays.forEach(paint);
        }
    }

    function lock(time, u, y, hardDrop) {
        sequence++;
        let side = u < 0.5 ? -1 : 1;
        if (Math.abs(u - 0.5) < 0.08) side = sequence % 2 ? -1 : 1;
        stage(time, 1, bounded(y, -0.62, 0.62), hardDrop ? 0.36 : 0.15, side, (stitch) => {
            if (hardDrop) {
                stitch('fall', 0, 0, 0.37, 0.95, -0.19, INK.ice, 1.08, 0, 0.94, 5.2);
                stitch('fall', 0.13, -0.06, 0.37, 0.73, -0.28, INK.cyan, 0.65, 0.045, 0.96);
                stitch('petal', -0.05, -0.68, 0.55, 0.26, 0.56, INK.pearl, 0.9, 0.24, 0.78);
            } else {
                stitch('shuttle', 0, 0, 0.95, 0.28, 0.26, INK.cyan, 0.92, 0, 0.84);
            }
        });
    }

    function spin(time, cleared = false) {
        const side = sequence % 2 ? 1 : -1;
        stage(time, 3, cleared ? 0.03 : -0.17, cleared ? 0.34 : 0.23, cleared ? 0 : side, (stitch) => {
            stitch('spiral', 0, 0, 0.98, 0.74, 0.38, INK.violet, 1.35, 0, 1.75, 5.4);
            stitch('spiral', 0, 0, 0.75, 0.59, 0.83, INK.pink, 0.82, 0.09, 1.72);
        });
    }

    function b2b(time) {
        stage(time, 4, 0.02, 0.48, 0, (stitch) => {
            stitch('helix', 0, 0, 0.22, 0.99, 0.12, INK.gold, 1.4, 0, 2.15, 5.8);
            stitch('helix', 0, 0, -0.22, 0.99, 0.12, INK.pearl, 0.95, 0.07, 2.15);
        });
    }

    function perfect(time) {
        stage(time, 6, 0.02, 0.5, 0, (stitch) => {
            // Four long, swept compass points, bound with dashed gold thread.
            // Start them clear of the hub; its light belongs to the rim peg.
            for (let i = 0; i < 4; i++) {
                const a = i * (PI / 2) + 0.29;
                const reach = i % 2 ? 0.72 : 0.94;
                const x = cos(a) * 0.055;
                const y = sin(a) * 0.055;
                const hue = i % 2 ? INK.ice : INK.gold;
                stitch('quill', x, y, reach, 0.41, a, hue, 1.08, i * 0.057, 2.9, 4.05, 0.41);
                stitch('quill', x, y, reach, -0.22, a, INK.gold, 0.92, 0.13 + i * 0.057, 2.75, 3.45, 0.96);
                if (capacity >= 48) {
                    stitch('quill', x, y, reach * 0.76, 0.05, a + 0.1, INK.pearl, 0.64, 0.28, 2.65, 2.8, 0.74);
                }
            }
            stitch('arc', 0, 0, 0.66, 0.56, 0.31, INK.gold, 0.87, 0.31, 2.7, 3.5, 0.91);
            stitch('arc', 0, 0, 0.54, 0.46, 3.67, INK.ice, 0.76, 0.45, 2.63, 3.2, 0.78);
            stitch('arc', 0, 0, 0.17, 0.17, 1.31, INK.pearl, 1.05, 0.51, 2.62, 3.8, 0.32);
        });
    }

    function clear(time, cue, meanY) {
        const count = bounded(cue.lines, 1, 4);
        const y = bounded(meanY, -0.60, 0.58);
        if (cue.perfect) perfect(time);
        else if (count === 4) {
            stage(time, 4, 0.06, 0.49, 0, (stitch) => {
                for (let i = 0; i < 4; i++) {
                    const a = -0.84 + i * 0.55 + sin(i * 2.2) * 0.055;
                    const reach = 1.16 + 0.22 * cos(i * 1.8 + 1.4);
                    const peg = -0.16 + i * 0.042;
                    const delay = i * 0.09;
                    const hue = i % 2 ? INK.gold : INK.pink;
                    stitch('quill', -0.45, peg, reach, 0.39, a, hue, 1.04, delay, 2.24, 4.15, 0.48);
                    stitch('quill', -0.45, peg, reach * 0.96, -0.17, a, INK.pearl, 0.74, 0.12 + delay, 2.05, 3.2, 0.93);
                }
            });
        } else if (!cue.twist && !cue.b2b && cue.cascade <= 1) {
            stage(time, 2, y * 0.88, 0.29 + count * 0.055, 0, (stitch, side) => {
                for (let i = 0; i < count; i++) {
                    const a = 0.26 + (i - (count - 1) * 0.5) * 0.44;
                    const hue = (i + (side > 0 ? 1 : 0)) % 2 ? INK.pink : INK.cyan;
                    stitch(i === 1 ? 'feather' : 'whisker', 0, 0, 0.94, 0.32, a, hue, 1.1, i * 0.07, 1.4, 4.8);
                }
            });
        }
        if (cue.cascade > 1) {
            const waves = Math.min(5, Math.max(2, cue.cascade));
            stage(time, 3, y * 0.53, 0.42, 0, (stitch) => {
                for (let i = 0; i < waves; i++) {
                    const x = i * 0.09 - 0.15;
                    const yOffset = 0.52 - i * 0.23;
                    const hue = i % 2 ? INK.ice : INK.cyan;
                    stitch('whisker', x, yOffset, 0.81 - i * 0.045, -0.47, -0.46, hue, 1.13, i * 0.105, 1.64, 4.5);
                }
            });
        }
        if (cue.twist) spin(time, true);
        if (cue.b2b) b2b(time);
    }

    function combo(time, count) {
        if (count < 2) return;
        const side = count % 2 ? 1 : -1;
        stage(time, 3, 0.34, 0.26 + Math.min(0.13, count * 0.018), side, (stitch) => {
            stitch('chain', 0, 0, 0.97, 0.39, 0.49, INK.gold, 1.3, 0, 1.82, 5.1);
            stitch('chain', 0, 0, 0.83, 0.29, 0.49, INK.pink, 0.73, 0.12, 1.72);
        });
    }

    function levelUp(time) {
        stage(time, 5, 0.06, 0.53, 0, (stitch) => {
            // The spine rises beside the dial. Each barb takes its root from
            // that exact curve and points up the rim as the new level arrives.
            const tilt = 1.43;
            const reach = 1.66;
            const bend = 0.43;
            stitch('quill', -0.35, -0.86, reach, bend, tilt, INK.pearl, 1.07, 0, 2.7, 3.95, 0.35);
            for (let i = 0; i < 5; i++) {
                const t = 0.12 + i * 0.138;
                const [along, cross] = STITCHES.quill(t);
                const x = -0.35 + cos(tilt) * along * reach - sin(tilt) * cross * bend;
                const y = -0.86 + sin(tilt) * along * reach + cos(tilt) * cross * bend;
                const w = 1.01 - i * 0.116;
                const angle = 0.39 + i * 0.103;
                const hue = i % 2 ? INK.cyan : INK.gold;
                const delay = 0.12 + i * 0.10;
                stitch('quill', x, y, w, 0.41, angle, hue, 0.99, delay, 2.45, 3.77, 0.46);
                stitch('quill', x, y, w * 0.91, -0.19, angle, INK.gold, 0.74, delay + 0.07, 2.39, 2.9, 0.94);
            }
        });
    }

    function garbage(time, kind, amount = 1) {
        const weight = Math.log2(1 + bounded(Number(amount) || 1, 1, 16)) / 4;
        const side = sequence++ % 2 ? -1 : 1;
        if (kind === 'incoming') {
            // Crossing picks bite inward through opposite sides of the hoop.
            stage(time, 2, -0.21, 0.28 + weight * 0.11, 0, (stitch) => {
                stitch('quill', 0.82, 0.58, 1.41, 0.26, -2.58, INK.rust, 1.08, 0, 1.39, 4.5);
                stitch('quill', 0.55, -0.49, 1.14, -0.27, 2.48, INK.gold, 0.83, 0.12, 1.3, 3.4, 0.69);
            });
        } else if (kind === 'counter') {
            stage(time, 3, -0.15, 0.21 + weight * 0.12, side, (stitch) => {
                stitch('knot', 0, 0, 0.90, 0.90, 0.64, INK.silver, 1.2, 0, 1.68, 5.1);
                stitch('knot', 0, 0, 0.74, 0.74, 0.72, INK.cyan, 0.79, 0.11, 1.57, 3.1, 0.65);
            });
        } else if (kind === 'outgoing') {
            stage(time, 2, 0.21, 0.33 + weight * 0.13, side, (stitch) => {
                stitch('quill', -0.77, -0.28, 1.7, -0.32, 0.39, INK.gold, 1.24, 0, 1.07, 4.6);
                stitch('quill', -0.62, -0.36, 1.62, -0.41, 0.46, INK.pearl, 0.89, 0.06, 1.14, 3.6, 0.64);
                stitch('quill', -0.44, -0.39, 1.28, -0.39, 0.5, INK.rust, 0.71, 0.1, 1.08, 3.3, 0.48);
            });
        }
    }

    function end(time) {
        const duration = 2.91;
        const stagger = 0.23;
        endingUntil = time + duration + 2 * stagger;
        stage(time, 2, -0.27, 0.36, 0, (stitch) => {
            for (let i = 0; i < 3; i++) {
                const x = (i - 1) * 0.25;
                const y = 0.23 - i * 0.105;
                const hue = i === 1 ? INK.silver : INK.mauve;
                const tilt = -0.07 - i * 0.09;
                stitch('looseEnd', x, y, 0.34 + i * 0.1, 0.71, tilt, hue, 0.71, i * stagger, duration, 3.6, -1);
            }
        });
    }

    function milestone(time, kind) {
        if (kind === 'goal') {
            stage(time, 5, 0.16, 0.35, 0, (stitch) => {
                const tilt = 0.25;
                stitch('blossom', 0, 0, 0.89, 0.89, tilt, INK.pink, 1.03, 0, 2.77, 3.8, 0.36);
                stitch('blossom', 0, 0, 0.58, 0.58, tilt + 0.11, INK.gold, 0.88, 0.18, 2.64, 3.2, 0.84);
                for (let i = 0; i < 5; i++) {
                    const a = (i * TAU) / 5 + tilt;
                    const x = 0.12 * cos(a - 0.25);
                    const y = 0.12 * sin(a - 0.25);
                    stitch('quill', x, y, 0.77, 0.23, a, INK.pearl, 0.77, i * 0.074, 2.47, 3.1, 0.76);
                }
            });
        } else if (kind === 'victory') {
            stage(time, 5, 0.28, 0.46, 0, (stitch) => {
                // Joined at the innermost root: the crest carries the eye out
                // and up, with the shorter feathers cooling to violet behind.
                const hues = [INK.pearl, INK.cyan, INK.ice, INK.violet, INK.pink];
                for (let i = 0; i < hues.length; i++) {
                    const reach = 0.92 - 0.071 * i;
                    const rootX = -0.96 + reach;
                    const angle = 0.16 - i * 0.048;
                    const delay = i * 0.10;
                    const y = -0.28 - i * 0.047;
                    const bend = 0.81 - i * 0.11;
                    const power = 0.94 - i * 0.055;
                    const width = 3.9 - i * 0.16;
                    const couch = i % 2 ? 0.64 : 0.31;
                    stitch('wing', rootX, y, reach, bend, angle, hues[i], power, delay, 3.25, width, couch);
                }
            });
        } else if (kind === 'round') {
            stage(time, 3, -0.03, 0.28, 0, (stitch, side) => {
                // The two shallow pans hang at different heights, each by
                // two silver chains. The board occupies the beam between them.
                const lift = side * 0.14;
                stitch('quill', -0.78, 0.78, 0.91, 0.12, -0.13, INK.gold, 0.8, 0, 2.18, 3.6, 0.46);
                stitch('quill', 0.12, 0.65, 1.02 - lift, 0.04, -2.19, INK.silver, 0.75, 0.09, 2.14, 3.4, 0.89);
                stitch('quill', 0.12, 0.65, 1.02 - lift, -0.04, -0.96, INK.silver, 0.75, 0.14, 2.14, 3.4, 0.89);
                stitch('arc', 0.12, -0.057 + lift * 0.82, 0.65, 0.39, PI, INK.gold, 1.02, 0.25, 2.13, 3.8, 0.27);
            });
        } else if (kind === 'topout') {
            // The host can announce the final knockout after the end of the match.
            if (time < endingUntil) return;
            const side = sequence++ % 2 ? -1 : 1;
            stage(time, 3, -0.1, 0.31, side, (stitch) => {
                // A taut wire goes slack on opposite sides of its break.
                stitch('quill', -0.94, -0.46, 0.91, 0.09, 0.47, INK.rust, 1.01, 0, 1.52, 4.1);
                stitch('quill', 0.94, 0.47, 0.72, -0.07, PI + 0.45, INK.silver, 0.85, 0, 1.56, 3.55, 0.59);
                stitch('quill', -0.27, -0.13, 0.32, 0.45, -0.79, INK.mauve, 0.96, 0.1, 1.72, 3.75);
                stitch('quill', 0.40, 0.21, 0.3, -0.40, 2.35, INK.pearl, 0.72, 0.12, 1.68, 3.3, 0.71);
            });
        } else if (kind === 'respawn') {
            const side = sequence++ % 2 ? -1 : 1;
            stage(time, 4, -0.07, 0.28, side, (stitch) => {
                stitch('quill', -0.2, -0.89, 0.86, 0.28, 1.35, INK.silver, 0.93, 0, 2.22, 3.7, 0.41);
                stitch('petal', -0.02, -0.09, 0.91, 0.46, 1.30, INK.cyan, 1.08, 0.12, 2.15, 4.25, 0.23);
                stitch('petal', -0.02, -0.09, 0.58, 0.28, 1.65, INK.gold, 0.83, 0.23, 2.03, 3.3, 0.77);
                stitch('quill', -0.13, -0.4, 0.61, 0.37, 2.56, INK.ice, 0.89, 0.28, 2.08, 3.35, 0.4);
            });
        }
    }

    return {
        mesh,
        lock,
        clear,
        combo,
        spin,
        perfect,
        levelUp,
        b2b,
        garbage,
        end,
        milestone,
        setLayout(layout, aspect, loom) { bays = openBays(layout, aspect, loom); },
        update(time, reducedMotion) {
            for (let i = occupied - 1; i >= 0; i--) {
                if (time < ends[i]) continue;
                occupied--;
                if (i < occupied) {
                    data.copyWithin(i * STRIDE, occupied * STRIDE, (occupied + 1) * STRIDE);
                    ends[i] = ends[occupied];
                    priority[i] = priority[occupied];
                    dirty = true;
                }
            }
            geometry.instanceCount = occupied;
            if (dirty) uploadUsed(upload, occupied * STRIDE);
            dirty = false;
            motion.value = reducedMotion ? 0 : 1;
            light.value = 0.53 + 0.47 * flashScale();
        },
        reset() {
            occupied = 0;
            sequence = 0;
            endingUntil = -Infinity;
            geometry.instanceCount = 0;
            dirty = false;
        },
        dispose() { geometry.dispose(); material.dispose(); atlas.dispose(); },
    };
}
