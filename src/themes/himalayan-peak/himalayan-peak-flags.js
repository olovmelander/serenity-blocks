/**
 * Himalayan Peak — the lines of prayer flags.
 *
 * Lung ta: five colours in their order (sky, air, fire, water, earth), strung from the chorten's
 * spire and the cairn's pole and out of the frame. They are what the board touches first:
 *
 *  - a lock sends a gust along the nearest line from where the piece left the card: the flags
 *    lift and snap as the front passes them, and the ones nearest take the piece's colour and
 *    HOLD it as light for half a minute, so the lines slowly fill with the colours played;
 *  - a clear lets go of everything the lines hold (the world throws the papers).
 *
 * Every flag is one instance of a small grid. Its cloth is closed form: it hangs from a cord
 * that sways downwind, streams at an angle the wind sets, and ripples in travelling waves that
 * grow toward its free edge. The cords are ribbons widened in screen space so they never thin
 * below a pixel. Nothing is simulated and nothing is created at event time.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniformArray,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BLESS_HOLD, BLESS_MAX, GUST_FADE, GUST_SLOTS, GUST_SPEED, LUNG_TA,
} from './himalayan-peak-core.js';
import { linePoint } from './himalayan-peak-layout.js';
import {
    hpFxMaterial, hpPart, hpQuadGeometry, hpSolidMaterial,
} from './himalayan-peak-tsl.js';

/** The wind's heading near the viewer (unit): from the left, a little away and up. */
const DOWNWIND = new THREE.Vector3(1, 0.07, -0.34).normalize();
/** Segments each cord is drawn with. */
const CORD_SEGMENTS = 22;
/** The most lines a layout strings. */
export const MAX_LINES = 6;

/** How far the wind pushes a cord's belly (metres per unit of `weight`) and how it swings. */
const cordSway = (u, weight, line) => {
    const swing = sin(u.time.mul(0.9).add(line.mul(1.7))).mul(0.12).add(sin(u.time.mul(0.37).add(line)).mul(0.08));
    return vec3(DOWNWIND.x, DOWNWIND.y, DOWNWIND.z).mul(weight.mul(u.gale.mul(0.7).add(0.25).add(swing)));
};

/** The gusts passing a point `along` metres down line `line`: how hard they pull right now. */
const gustAt = (u, line, along) => {
    let sum = float(0.0);
    for (let i = 0; i < GUST_SLOTS; i++) {
        const A = u.gustA[i];
        const since = u.time.sub(A.z).sub(abs(along.sub(A.y)).div(GUST_SPEED));
        // A slot for line −1 runs along every line at once.
        const mine = float(1.0).sub(step(0.5, abs(line.sub(A.x)))).add(step(A.x, -0.5));
        sum = sum.add(exp(max(since, 0.0).div(-GUST_FADE)).mul(step(0.0, since)).mul(A.w).mul(clamp(mine, 0.0, 1.0)));
    }
    return sum;
};

/**
 * @param {object} u  shared uniforms
 * @param {object} options
 * @param {number} options.flags  flags in the pool
 */
export function createFlags(u, { flags = 180 } = {}) {
    const count = flags;
    const aAnchor = new Float32Array(count * 4);
    const aAxis = new Float32Array(count * 4);
    const aKind = new Float32Array(count * 4);
    const aHeld = new Float32Array(count * 4);
    const aWhen = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aWhen.set([-1000, 1e6, 0, 0], i * 4);
    const geometry = new THREE.InstancedBufferGeometry();
    {
        // A flag: 6 × 4 cells, x across the cord, y down from it (0 at the cord).
        const nx = 6;
        const ny = 4;
        const position = [];
        const uvs = [];
        const index = [];
        for (let j = 0; j <= ny; j++) {
            for (let i = 0; i <= nx; i++) {
                position.push(i / nx - 0.5, j / ny, 0);
                uvs.push(i / nx, j / ny);
            }
        }
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const a = j * (nx + 1) + i;
                const c = a + nx + 1;
                index.push(a, c, a + 1, a + 1, c, c + 1);
            }
        }
        geometry.setIndex(index);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    const instanced = {
        aAnchor, aAxis, aKind, aHeld, aWhen,
    };
    Object.keys(instanced).forEach((name) => {
        const attr = new THREE.InstancedBufferAttribute(instanced[name], 4);
        attr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, attr);
    });
    geometry.instanceCount = 0;

    const anchor = attribute('aAnchor', 'vec4');
    const axis = attribute('aAxis', 'vec4');
    const kind = attribute('aKind', 'vec4');
    const held = attribute('aHeld', 'vec4');
    const when = attribute('aWhen', 'vec4');
    const palette = uniformArray(LUNG_TA.map((c) => new THREE.Vector3(c[0], c[1], c[2])));

    const material = hpSolidMaterial('HimalayanPeakFlags');
    material.side = THREE.DoubleSide;
    const across = positionGeometry.x;
    const down = positionGeometry.y;
    const gust = gustAt(u, kind.z, anchor.w);
    const blow = u.gale.add(gust.mul(1.4));
    // The cloth streams: it hangs when the air is still and flies level in a gale.
    const lift = clamp(float(0.2).add(blow.mul(0.72)), 0.0, 1.32);
    const wind = vec3(DOWNWIND.x, DOWNWIND.y, DOWNWIND.z);
    const fall = normalize(vec3(0.0, -1.0, 0.0).mul(lift.cos()).add(wind.mul(lift.sin())));
    const face = normalize(cross(axis.xyz, fall));
    const speed = float(5.5).add(blow.mul(7.0));
    const phase = kind.y.mul(6.283);
    const wave = sin(down.mul(5.2).sub(u.time.mul(speed)).add(phase).add(across.mul(2.4)));
    const wave2 = sin(down.mul(9.7).sub(u.time.mul(speed.mul(1.7))).add(phase.mul(1.9)).sub(across.mul(4.1)));
    const ripple = wave.mul(0.62).add(wave2.mul(0.38)).mul(down).mul(float(0.07).add(blow.mul(0.09)));
    const size = axis.w;
    const world = anchor.xyz
        .add(cordSway(u, kind.w, kind.z))
        .add(axis.xyz.mul(across.mul(size)))
        .add(fall.mul(down.mul(size).mul(1.16)))
        .add(face.mul(ripple.mul(size).mul(2.2)))
        // The free corners curl in a little.
        .add(axis.xyz.mul(across.mul(down).mul(ripple).mul(size).mul(-1.4)));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
    const vTint = varying(palette.element(kind.x.add(0.5).toInt()), 'hpFlagTint');
    const vFold = varying(wave.mul(0.62).add(wave2.mul(0.38)).mul(down), 'hpFlagFold');
    const vFace = varying(face, 'hpFlagFace');
    const vWorld = varying(world, 'hpFlagWorld');
    // What the flag holds: the piece's light from the moment its gust arrived, until a clear.
    const since = u.time.sub(when.x);
    // Until a new gust arrives the flag shows what it held before (`when.w`).
    const kept = mix(when.w, exp(max(since, 0.0).div(-BLESS_HOLD)).mul(held.w), step(0.0, since)).mul(step(u.time, when.y));
    const struck = exp(max(since, 0.0).div(-0.4)).mul(step(0.0, since)).mul(when.z);
    const gone = u.time.sub(when.y);
    // What it lets go of is what it had left at that moment.
    // (Released while a gust was still on its way, that is what it held before.)
    const left = mix(when.w, held.w.mul(exp(when.x.sub(when.y).div(BLESS_HOLD))), step(when.x, when.y));
    const freed = exp(max(gone, 0.0).div(-0.32)).mul(step(0.0, gone)).mul(left);
    const vGlow = varying(vec4(held.rgb.mul(kept.mul(0.9).add(struck.mul(2.4))).add(vec3(1.0, 0.86, 0.6).mul(freed.mul(1.6))), gust), 'hpFlagGlow');

    material.colorNode = Fn(() => {
        const st = uv();
        // A block print: a frame, and lines of script inside it.
        const frame = smoothstep(0.34, 0.37, max(abs(st.x.sub(0.5)), abs(st.y.sub(0.5)).mul(0.92)))
            .mul(smoothstep(0.43, 0.4, max(abs(st.x.sub(0.5)), abs(st.y.sub(0.5)).mul(0.92))));
        const script = smoothstep(0.55, 0.75, u.noise(vec2(st.x.mul(2.6), st.y.mul(0.09).add(vTint.x))).w)
            .mul(sin(st.y.mul(62.0)).mul(0.5).add(0.5))
            .mul(step(abs(st.x.sub(0.5)), 0.3)).mul(step(abs(st.y.sub(0.5)), 0.32));
        const ink = clamp(frame.add(script.mul(0.8)), 0.0, 1.0);
        const cloth = vTint.mul(float(1.0).sub(ink.mul(0.5)));
        const N = normalize(vFace);
        const V = normalize(cameraPosition.sub(vWorld));
        const sun = u.nearSun;
        // Thin cotton: lit from either side, and it burns when the sun is behind it.
        const through = smoothstep(-0.2, 0.9, dot(V.negate(), u.sunDir));
        const lit = u.sunCol.mul(abs(dot(N, u.sunDir)).mul(0.55).add(through.mul(0.6)).mul(sun));
        const ambient = u.shade.mul(1.25).add(u.zenith.mul(0.9)).add(u.horizon.mul(0.25));
        const fold = vFold.mul(0.3).add(0.82);
        const col = cloth.mul(lit.add(ambient)).mul(fold);
        // Held light glows from inside the weave, strongest where the print is not.
        const glow = vGlow.rgb.mul(float(1.0).sub(ink.mul(0.35))).mul(mix(float(0.8), float(1.25), st.y));
        return col.add(glow).mul(u.breath.mul(0.85).add(0.15));
    })();

    const part = hpPart('HimalayanPeakFlags', geometry, material, -4);
    part.count = count;
    part.live = 0;
    /** Per live flag: its line, metres along it, and where it hangs. */
    part.info = [];
    const dirty = (...names) => names.forEach((name) => {
        geometry.getAttribute(name).needsUpdate = true;
    });

    /**
     * String the flags along `lines` (himalayan-peak-layout.js). Held light is dropped.
     * @returns {number} flags strung
     */
    part.string = (lines) => {
        const wanted = lines.reduce((sum, line) => sum + line.count, 0);
        // A richer tier strings its lines closer, up to flags hanging edge to edge.
        const scale = count / Math.max(1, wanted);
        part.info = [];
        let n = 0;
        const p = [0, 0, 0];
        const q = [0, 0, 0];
        lines.forEach((line, id) => {
            const length = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1], line.b[2] - line.a[2]);
            const fits = Math.max(1, Math.floor((length * 0.9) / (line.size * 1.1)));
            const strung = Math.max(1, Math.min(fits, Math.round(line.count * scale)));
            for (let k = 0; k < strung && n < count; k++) {
                // Clear of the knots at both ends.
                const s = 0.06 + ((k + 0.5) / strung) * 0.9;
                linePoint(line, s, p);
                linePoint(line, s + 0.01, q);
                const t = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
                const len = Math.hypot(t[0], t[1], t[2]) || 1;
                aAnchor.set([p[0], p[1], p[2], s * length], n * 4);
                aAxis.set([t[0] / len, t[1] / len, t[2] / len, line.size], n * 4);
                aKind.set([k % 5, ((k * 0.618 + id * 0.37) % 1), id, Math.sin(Math.PI * s) * (0.3 * line.sag + 0.12)], n * 4);
                aHeld.set([1, 1, 1, 0], n * 4);
                aWhen.set([-1000, 1e6, 0, 0], n * 4);
                part.info.push({
                    line: id, along: s * length, x: p[0], y: p[1], z: p[2], tint: k % 5,
                });
                n += 1;
            }
        });
        part.live = n;
        geometry.instanceCount = n;
        dirty('aAnchor', 'aAxis', 'aKind', 'aHeld', 'aWhen');
        return n;
    };

    /**
     * Give the flags of `line` within `spread` metres of `along` the colour `rgb`: each takes it
     * when the gust that left at `time` reaches it. `amount` in lock units.
     * @returns {number} flags blessed
     */
    part.bless = (line, along, rgb, time, amount = 1, spread = 3.2) => {
        let n = 0;
        for (let i = 0; i < part.live; i++) {
            const f = part.info[i];
            if (f.line !== line) continue;
            const d = Math.abs(f.along - along);
            if (d > spread) continue;
            const share = amount * (1 - (d / spread) ** 2);
            const o = i * 4;
            const arrive = time + d / GUST_SPEED;
            // What it still holds carries over, capped.
            const before = part.heldAt(i, arrive);
            const total = Math.min(BLESS_MAX, before + share);
            const k = share / Math.max(1e-4, before + share);
            aHeld.set([
                aHeld[o] + (rgb[0] - aHeld[o]) * k,
                aHeld[o + 1] + (rgb[1] - aHeld[o + 1]) * k,
                aHeld[o + 2] + (rgb[2] - aHeld[o + 2]) * k,
                total,
            ], o);
            aWhen.set([arrive, 1e6, share, before], o);
            n += 1;
        }
        if (n) dirty('aHeld', 'aWhen');
        return n;
    };

    /** What flag `i` holds at `time`. */
    part.heldAt = (i, time) => {
        const o = i * 4;
        const age = time - aWhen[o];
        if (time >= aWhen[o + 1]) return 0;
        // A gust still on its way: the flag shows what it held before.
        if (age < 0) return aWhen[o + 3];
        return aHeld[o + 3] * Math.exp(-age / BLESS_HOLD);
    };

    /** Everything the lines hold at `time`. */
    part.totalHeld = (time) => {
        let sum = 0;
        for (let i = 0; i < part.live; i++) sum += part.heldAt(i, time);
        return sum;
    };

    /**
     * A clear at `time` lets go of what every flag holds (each a moment after its neighbour,
     * `stagger` seconds per metre from `from`). Returns the flags that held something.
     */
    part.release = (time, from = null, stagger = 0.012) => {
        const out = [];
        for (let i = 0; i < part.live; i++) {
            const f = part.info[i];
            const at = time + (from ? Math.hypot(f.x - from[0], f.y - from[1], f.z - from[2]) * stagger : 0);
            const amount = part.heldAt(i, at);
            if (amount < 0.05) continue;
            aWhen[i * 4 + 1] = at;
            const o = i * 4;
            out.push({
                index: i, time: at, amount, x: f.x, y: f.y, z: f.z, rgb: [aHeld[o], aHeld[o + 1], aHeld[o + 2]],
            });
        }
        if (out.length) dirty('aHeld', 'aWhen');
        return out;
    };

    part.reset = () => {
        for (let i = 0; i < count; i++) {
            aHeld[i * 4 + 3] = 0;
            aWhen.set([-1000, 1e6, 0, 0], i * 4);
        }
        dirty('aHeld', 'aWhen');
    };
    return part;
}

/**
 * The cords the flags hang from: ribbons, widened on screen so they hold a pixel.
 * @param {object} u
 */
export function createCords(u) {
    const count = MAX_LINES * CORD_SEGMENTS;
    const aFrom = new Float32Array(count * 4);
    const aTo = new Float32Array(count * 4);
    const geometry = hpQuadGeometry(count, { aFrom: [aFrom, 4], aTo: [aTo, 4] });
    ['aFrom', 'aTo'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = 0;
    const from = attribute('aFrom', 'vec4');
    const to = attribute('aTo', 'vec4');
    const line = to.w.floor();

    const material = hpFxMaterial('HimalayanPeakCords');
    const t = positionGeometry.x.add(0.5);
    const p0 = from.xyz.add(cordSway(u, from.w, line));
    const p1 = to.xyz.add(cordSway(u, to.w.fract().mul(4.0), line));
    const viewProjection = (p) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1.0));
    const c0 = viewProjection(p0);
    const c1 = viewProjection(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 0.05)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 0.05)).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, t);
    // A centimetre of cord, never under a pixel and a bit.
    const widthPx = max(u.viewport.y.mul(0.011).div(max(clip.w, 0.3)), u.viewport.y.mul(0.0011));
    material.vertexNode = vec4(clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(clip.w)), clip.z, clip.w);
    material.colorNode = Fn(() => {
        const edge = float(1.0).sub(abs(uv().y.sub(0.5)).mul(2.0));
        const a = smoothstep(0.0, 0.6, edge).mul(0.92);
        const cord = vec3(0.045, 0.036, 0.03).add(u.shade.mul(0.08));
        return vec4(cord.mul(a), a);
    })();

    const part = hpPart('HimalayanPeakCords', geometry, material, 34);
    /** Lay the cords along `lines`. */
    part.string = (lines) => {
        let n = 0;
        const p = [0, 0, 0];
        const q = [0, 0, 0];
        lines.slice(0, MAX_LINES).forEach((ln, id) => {
            const weight = (s) => Math.sin(Math.PI * s) * (0.3 * ln.sag + 0.12);
            for (let k = 0; k < CORD_SEGMENTS; k++) {
                const s0n = k / CORD_SEGMENTS;
                const s1n = (k + 1) / CORD_SEGMENTS;
                linePoint(ln, s0n, p);
                linePoint(ln, s1n, q);
                aFrom.set([p[0], p[1], p[2], weight(s0n)], n * 4);
                // The far end's sway weight rides in the fraction (÷ 4), the line's id in the whole.
                aTo.set([q[0], q[1], q[2], id + Math.min(0.999, weight(s1n) / 4)], n * 4);
                n += 1;
            }
        });
        geometry.instanceCount = n;
        geometry.getAttribute('aFrom').needsUpdate = true;
        geometry.getAttribute('aTo').needsUpdate = true;
    };
    return part;
}

export { DOWNWIND };
