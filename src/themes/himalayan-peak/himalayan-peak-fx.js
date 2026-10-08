/**
 * Himalayan Peak — gameplay effects that are their own geometry.
 *
 *  - Paper horses: at a pass one throws a handful of printed paper squares into the wind. A
 *    locking piece leaves the card as a handful in its own colour; a clear lets a storm of them
 *    go, from the card and from every flag that was holding light. Each is a real square in the
 *    air: thrown, slowed, then carried up and away on the wind, tumbling, lit from either side.
 *    Its whole flight is closed form in the time since it was thrown.
 *  - Row beams: the cleared rows leave the card as blades of light at their own heights, drawn in
 *    screen space so they line up with the rows exactly.
 *  - Diamond dust: ice crystals in the air round the viewer that fire when the light finds them.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
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
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    EYE, LUNG_TA, TAU, hpFxMaterial, hpPart, hpQuadGeometry, mulberry32,
} from './himalayan-peak-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Paper horses ────────────────────────────────────────────────────────────────

/** How fast a thrown paper loses its own speed (1/s), and what the wind then carries it at. */
const PAPER_DRAG = 2.4;
export const PAPER_WIND = Object.freeze([1.15, 2.3, -4.2]);

/**
 * Where a paper thrown from `from` with velocity `vel` is `tau` seconds later, flutter aside.
 * `side` = −1 / +1: the wind parts round the viewer. CPU twin of the shader.
 */
export function paperPoint(from, vel, tau, side = 1, gale = 0.25, out = [0, 0, 0]) {
    const h = (1 - Math.exp(-tau * PAPER_DRAG)) / PAPER_DRAG;
    const carried = Math.max(0, tau - h) * (0.7 + gale);
    out[0] = from[0] + vel[0] * h + PAPER_WIND[0] * side * carried;
    out[1] = from[1] + vel[1] * h + PAPER_WIND[1] * carried;
    out[2] = from[2] + vel[2] * h + PAPER_WIND[2] * carried;
    return out;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createPapers(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    const aTurn = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = hpQuadGeometry(count, {
        aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4], aTurn: [aTurn, 4],
    });
    ['aBirth', 'aVel', 'aTint', 'aTurn'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    // (seed, turns per second, side −1 / +1, how long it glows)
    const turn = attribute('aTurn', 'vec4');

    const material = hpFxMaterial('HimalayanPeakPapers');
    const tau = u.time.sub(birth.w);
    const lasts = vel.w;
    const alive = step(0.0, tau).mul(step(tau, lasts));
    const t = max(tau, 0.0);
    const h = float(1.0).sub(exp(t.mul(-PAPER_DRAG))).div(PAPER_DRAG);
    const carried = max(t.sub(h), 0.0).mul(u.gale.add(0.7));
    const seed = turn.x;
    // The air is never smooth: each paper wanders about its own path.
    const wander = vec3(
        sin(t.mul(seed.mul(2.0).add(2.3)).add(seed.mul(41.0))),
        sin(t.mul(seed.mul(1.6).add(3.1)).add(seed.mul(17.0))).mul(0.7),
        cos(t.mul(seed.mul(2.4).add(1.9)).add(seed.mul(29.0))),
    ).mul(smoothstep(0.1, 1.2, t).mul(0.32));
    const centre = birth.xyz
        .add(vel.xyz.mul(h))
        .add(vec3(turn.z.mul(PAPER_WIND[0]), PAPER_WIND[1], PAPER_WIND[2]).mul(carried))
        .add(wander);
    // It tumbles: a frame that turns about a leaning axis.
    const angle = t.mul(turn.y).mul(TAU).add(seed.mul(53.0));
    const lean = seed.mul(TAU);
    const axis = normalize(vec3(cos(lean), 0.5, sin(lean)));
    const side0 = normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
    const side1 = cross(axis, side0);
    const right = side0.mul(cos(angle)).add(side1.mul(sin(angle)));
    const flutter = sin(angle.mul(0.37).add(seed.mul(7.0))).mul(0.9);
    const upDir = normalize(axis.mul(cos(flutter)).add(cross(right, axis).mul(sin(flutter))));
    const edge = tint.w.mul(alive);
    const world = centre.add(right.mul(positionGeometry.x.mul(edge))).add(upDir.mul(positionGeometry.y.mul(edge)));
    material.vertexNode = viewProjection(world);
    const vNormal = varying(normalize(cross(right, upDir)), 'hpPaperN');
    const vWorld = varying(centre, 'hpPaperP');
    const fade = smoothstep(0.0, 0.05, t).mul(float(1.0).sub(smoothstep(lasts.mul(0.72), lasts, t))).mul(alive);
    // It leaves the board still lit and cools to plain paper.
    const vTint = varying(vec4(tint.rgb, exp(t.div(max(turn.w, 0.05)).negate()).mul(alive)), 'hpPaperTint');
    const vFade = varying(fade, 'hpPaperFade');
    material.colorNode = Fn(() => {
        const st = uv();
        const N = normalize(vNormal);
        const V = normalize(cameraPosition.sub(vWorld));
        // The print: a darker block in the middle of the square.
        const block = smoothstep(0.3, 0.27, max(abs(st.x.sub(0.5)), abs(st.y.sub(0.5))))
            .mul(float(1.0).sub(smoothstep(0.2, 0.17, max(abs(st.x.sub(0.5)), abs(st.y.sub(0.5))))));
        const paper = vTint.rgb.mul(float(1.0).sub(block.mul(0.4)));
        const facing = abs(dot(N, V));
        const through = smoothstep(-0.3, 0.9, dot(V.negate(), u.sunDir));
        const lit = u.sunCol.mul(abs(dot(N, u.sunDir)).mul(0.6).add(through.mul(0.7)).mul(u.nearSun));
        const ambient = u.shade.mul(1.3).add(u.zenith.mul(1.0)).add(u.horizon.mul(0.3));
        // It flashes as it turns its face to the eye.
        const col = paper.mul(lit.add(ambient)).mul(facing.mul(0.6).add(0.5))
            .add(vTint.rgb.mul(vTint.a.mul(1.9)));
        const a = vFade.mul(0.96);
        return vec4(col.mul(u.breath.mul(0.85).add(0.15)).mul(a), a);
    })();

    const part = hpPart('HimalayanPeakPapers', geometry, material, 44);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` papers from a point at `time` (which may be a moment ahead).
     * @param {object} o
     * @param {number[]} o.from      where they leave from (near space)
     * @param {number[]} o.toward    the throw's heading (need not be unit)
     * @param {number[]} [o.speed]   (min, max) m/s
     * @param {number} [o.cone]      how wide the handful opens (0 = a jet, 1 = every way)
     * @param {number[]|null} [o.rgb]  one colour, or null for the five colours of lung ta
     * @param {number} [o.side]      −1 / +1: which way round the viewer the wind takes them
     */
    part.emit = ({
        from, toward = [0, 1, 0], n, rgb = null, time, speed = [2.5, 7], cone = 0.5, life = [2.6, 4.6], size = 0.085,
        side = 1, glow = 0.9, stagger = 0, jitter = 0.12,
    }) => {
        const rand = mulberry32(0x7a31 + bursts * 7919);
        bursts += 1;
        const len = Math.hypot(toward[0], toward[1], toward[2]) || 1;
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            // A random heading inside the cone about `toward`.
            const a = rand() * TAU;
            const z = rand() * 2 - 1;
            const s = Math.sqrt(1 - z * z);
            const v = speed[0] + (speed[1] - speed[0]) * rand() ** 1.5;
            const dx = toward[0] / len + Math.cos(a) * s * cone;
            const dy = toward[1] / len + z * cone * 0.8 + 0.12;
            const dz = toward[2] / len + Math.sin(a) * s * cone;
            const dl = Math.hypot(dx, dy, dz) || 1;
            aBirth.set([
                from[0] + (rand() - 0.5) * jitter,
                from[1] + (rand() - 0.5) * jitter,
                from[2] + (rand() - 0.5) * jitter,
                time + rand() * stagger,
            ], i * 4);
            aVel.set([(dx / dl) * v, (dy / dl) * v, (dz / dl) * v, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const c = rgb || LUNG_TA[Math.floor(rand() * 5) % 5];
            const g = 0.8 + rand() * 0.4;
            aTint.set([c[0] * g, c[1] * g, c[2] * g, size * (0.7 + rand() * 0.6)], i * 4);
            aTurn.set([rand(), 0.6 + rand() * 1.5, side, glow * (0.6 + rand() * 0.8)], i * 4);
        }
        ['aBirth', 'aVel', 'aTint', 'aTurn'].forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return total;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
        geometry.getAttribute('aBirth').needsUpdate = true;
        cursor = 0;
        bursts = 0;
    };
    part.count = count;
    return part;
}

// ── Row beams ───────────────────────────────────────────────────────────────────

export const BEAM_ROWS = 4;
/** Seconds a beam's head takes from the card to the edge of the frame, and its afterglow. */
export const BEAM_TRAVEL = 0.14;
export const BEAM_FADE = 0.17;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = hpQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = hpFxMaterial('HimalayanPeakRowBeams', { depthTest: false });
    const rowY = mix(
        mix(uniforms.rows.x, uniforms.rows.y, step(0.5, row.x)),
        mix(uniforms.rows.z, uniforms.rows.w, step(2.5, row.x)),
        step(1.5, row.x),
    );
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    // From the card's edge out to the edge of the frame.
    const edge = mix(uniforms.frame.x, uniforms.frame.y, step(0.0, row.y));
    const end = step(0.0, row.y);
    const sx = mix(edge, end, along);
    const thicknessPx = float(46.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'hpBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade: a hairline core in a soft sheath that widens as it leaves the card.
        const taper = mix(float(2.2), float(0.8), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(vAlong.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.17)).mul(0.34);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(vAlong).mul(float(1.0).sub(vAlong)).mul(0.9)
                .add(0.1));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.3));
        return vec4(col.mul(k).mul(2.4), 0.0);
    })();
    const part = hpPart('HimalayanPeakRowBeams', geometry, material, 60);
    part.uniforms = uniforms;
    /** `ys` = screen y of each cleared row; `x0`/`x1` = the card's edges; all in screen fractions. */
    part.fire = (ys, x0, x1, rgb, time, strength = 1) => {
        uniforms.rows.value.set(ys[0] ?? -1, ys[1] ?? -1, ys[2] ?? -1, ys[3] ?? -1);
        uniforms.frame.value.set(x0, x1, time, strength);
        uniforms.color.value.set(rgb[0], rgb[1], rgb[2]);
    };
    part.reset = () => {
        uniforms.frame.value.set(0.4, 0.6, -100, 0);
    };
    return part;
}

// ── Diamond dust ────────────────────────────────────────────────────────────────

/** The box of air round the viewer the dust lives in (metres). */
const DUST_BOX = [52, 22, 52];

/**
 * @param {object} u
 * @param {number} count
 */
export function createDust(u, count) {
    const aSeed = new Float32Array(count * 4);
    const rand = mulberry32(0xd057);
    for (let i = 0; i < count * 4; i++) aSeed[i] = rand();
    const geometry = hpQuadGeometry(count, { aSeed: [aSeed, 4] });
    const seed = attribute('aSeed', 'vec4');
    const material = hpFxMaterial('HimalayanPeakDust');
    // Carried on the wind and wrapped: the same crystal comes round again.
    const drift = vec3(u.windRun.mul(0.16), u.time.mul(-0.22).add(sin(u.time.mul(0.4).add(seed.w.mul(20.0))).mul(0.3)), u.windRun.mul(-0.05));
    const box = vec3(...DUST_BOX);
    const local = fract(seed.xyz.add(drift.div(box))).sub(0.5).mul(box);
    const world = vec3(EYE.x, EYE.y + 3.0, EYE.z - 8.0).add(local);
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    // Far ones are a pixel; near ones a few.
    const px = clamp(u.pxScale.mul(0.012).div(max(clip.w, 0.5)), 0.9, u.viewport.y.mul(0.004));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    // A crystal fires when it turns a face to the light: briefly, and not all at once.
    const fire = sin(u.time.mul(seed.w.mul(3.0).add(1.5)).add(seed.x.mul(60.0))).mul(0.5).add(0.5);
    const flash = fire.mul(fire).mul(fire).mul(fire);
    const reach = smoothstep(0.5, 0.36, length(local.div(box)));
    const light = u.sunCol.mul(u.nearSun.mul(1.6).add(u.surge.mul(1.2))).add(u.shade.mul(0.9)).add(u.zenith.mul(0.5));
    const vLight = varying(light.mul(flash.mul(reach)).mul(u.breath), 'hpDust');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        return vec4(vLight.mul(exp(d.mul(d).mul(-5.0))).mul(smoothstep(1.0, 0.6, d)), 0.0);
    })();
    const part = hpPart('HimalayanPeakDust', geometry, material, 46);
    part.count = count;
    return part;
}
