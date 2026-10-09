/**
 * Winter — gameplay effects that are their own geometry.
 *
 *  - Fox fires: one pool of sprites with two natures. A SPARK is thrown, slows, and is then
 *    drawn up into the sky, winding as it goes, a streak of light along its own path: this is
 *    what the fox's tail strikes from the snow and what a locking piece becomes. POWDER is the
 *    snow itself, kicked up: a soft cloud that spreads, hangs and settles, lit like the drifts.
 *    Both are closed form in the time since they were thrown.
 *  - Row beams: the cleared rows leave the card as blades of light at their own heights, drawn
 *    in screen space so they line up with the rows exactly.
 *  - Paw prints: where the fox has trodden the snow keeps a row of small hollows, each dark on
 *    its near side and lit on its far lip; made while the fires burn, they glow for a while.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    exp,
    float,
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
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    FOX_FIRE, TAU, mulberry32, wClip, wFxMaterial, wPart, wQuadGeometry,
} from './winter-tsl.js';

// ── Fox fires ───────────────────────────────────────────────────────────────────

/** How fast a thrown spark / a cloud of powder loses its own speed (1/s). */
export const SPARK_DRAG = 1.7;
export const POWDER_DRAG = 3.0;
/** Seconds a spark hangs before the sky begins to draw it up. */
export const SPARK_HANG = 0.22;

/**
 * Where a spark thrown from `from` with velocity `vel` is `tau` seconds later, its winding
 * aside. CPU twin of the shader.
 */
export function sparkPoint(from, vel, tau, lift, out = [0, 0, 0]) {
    const t = Math.max(0, tau);
    const h = (1 - Math.exp(-t * SPARK_DRAG)) / SPARK_DRAG;
    const rising = Math.max(0, t - SPARK_HANG);
    out[0] = from[0] + vel[0] * h;
    out[1] = from[1] + vel[1] * h + lift * rising * rising * 0.5;
    out[2] = from[2] + vel[2] * h;
    return out;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    const aKind = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
    const geometry = wQuadGeometry(count, {
        aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4], aKind: [aKind, 4],
    });
    ['aBirth', 'aVel', 'aTint', 'aKind'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');
    // (seed, nature: 0 spark / 1 powder, lift m/s², glow)
    const kind = attribute('aKind', 'vec4');

    const material = wFxMaterial('WinterFoxFires');
    const tau = u.time.sub(birth.w);
    const lasts = vel.w;
    const alive = step(0.0, tau).mul(step(tau, lasts));
    const t = max(tau, 0.0);
    const snowy = kind.y;
    const drag = mix(float(SPARK_DRAG), float(POWDER_DRAG), snowy);
    const h = float(1.0).sub(exp(t.mul(drag).negate())).div(drag);
    const rising = max(t.sub(SPARK_HANG), 0.0);
    const seed = kind.x;
    // A spark winds as it climbs; snowy only billows a little.
    const wind = smoothstep(0.1, 1.2, t).mul(mix(t.mul(0.3).add(0.3), float(0.12), snowy));
    const wander = vec3(
        sin(t.mul(seed.mul(2.0).add(2.3)).add(seed.mul(41.0))),
        sin(t.mul(seed.mul(1.6).add(3.1)).add(seed.mul(17.0))).mul(0.4),
        cos(t.mul(seed.mul(2.4).add(1.9)).add(seed.mul(29.0))),
    ).mul(wind);
    const carried = vec3(u.gale.mul(1.6), 0.0, u.gale.mul(0.4)).mul(max(t.sub(h), 0.0)).mul(snowy.mul(0.8).add(0.2));
    const centre = birth.xyz
        .add(vel.xyz.mul(h))
        .add(vec3(0.0, kind.z.mul(rising).mul(rising).mul(0.5), 0.0))
        .add(wander)
        .add(carried);
    // Which way it is going now: a spark is a streak along that.
    const going = vel.xyz.mul(exp(t.mul(drag).negate())).add(vec3(0.0, kind.z.mul(rising), 0.0))
        .add(vec3(cos(t.mul(seed.mul(2.0).add(2.3)).add(seed.mul(41.0))), 0.0, sin(t.mul(seed.mul(2.4).add(1.9)).add(seed.mul(29.0))).negate()).mul(wind.mul(2.0)));
    const pace = length(going);
    const clip = wClip(centre);
    const ahead = wClip(centre.add(going.div(max(pace, 1e-3)).mul(0.25)));
    const half = u.viewport.mul(0.5);
    const sc = clip.xy.div(max(clip.w, 1e-3));
    const sa = ahead.xy.div(max(ahead.w, 1e-3));
    const heading = sa.sub(sc).mul(half);
    const along = heading.div(max(length(heading), 1e-3));
    const across = vec2(along.y.negate(), along.x);
    // Powder spreads as it hangs.
    const metres = tint.w.mul(mix(float(1.0), t.mul(1.5).add(1.0), snowy));
    const wide = max(u.pxScale.mul(metres).div(max(clip.w, 0.3)), mix(float(1.3), float(2.0), snowy));
    const stretch = mix(clamp(pace.mul(0.55), 0.0, 9.0).add(1.6), float(1.0), snowy);
    const offset = along.mul(positionGeometry.y.mul(wide).mul(stretch)).add(across.mul(positionGeometry.x.mul(wide)));
    material.vertexNode = vec4(sc.add(offset.mul(2.0).div(half).mul(alive)).mul(clip.w), clip.z, clip.w);

    const fadeIn = smoothstep(0.0, mix(float(0.04), float(0.12), snowy), t);
    const fadeOut = float(1.0).sub(smoothstep(lasts.mul(mix(float(0.6), float(0.25), snowy)), lasts, t));
    const flicker = sin(t.mul(31.0).add(seed.mul(97.0))).mul(0.22).add(0.78);
    const vTint = varying(vec4(tint.rgb, fadeIn.mul(fadeOut).mul(alive)), 'wSparkTint');
    // (nature, glow · flicker, seed)
    const vKind = varying(vec3(snowy, kind.w.mul(mix(flicker, float(1.0), snowy)), seed), 'wSparkKind');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const isPowder = clamp(vKind.x, 0.0, 1.0);
        // A spark: a hot hairline with a halo, brightest at its head.
        const core = exp(q.x.mul(q.x).mul(-14.0)).mul(exp(q.y.mul(q.y).mul(-3.2))).mul(clamp(q.y.mul(0.4).add(0.6), 0.0, 1.0));
        const halo = exp(d.mul(d).mul(-3.0)).mul(0.1);
        const spark = mix(vTint.rgb, vec3(1.0), core.mul(0.45)).mul(core.add(halo)).mul(vKind.y).mul(vTint.a)
            .mul(8.0);
        // Powder: a soft cloud lit like the drifts, with a little of the piece's colour in it.
        const puff = smoothstep(1.0, 0.15, d);
        const a = puff.mul(puff).mul(vTint.a).mul(0.34);
        const lit = u.moonCol.mul(0.5).add(u.shade.mul(1.5)).add(u.glow.mul(0.25))
            .add(vTint.rgb.mul(vKind.y).mul(0.9));
        const cloud = lit.mul(a);
        return mix(vec4(spark.mul(u.breath.mul(0.85).add(0.15)), 0.0), vec4(cloud.mul(u.breath.mul(0.85).add(0.15)), a), isPowder);
    })();

    const part = wPart('WinterFoxFires', geometry, material, 46);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sprites from a point at `time` (which may be a moment ahead).
     * @param {object} o
     * @param {number[]} o.from      where they leave from
     * @param {number[]} o.toward    the throw's heading (need not be unit)
     * @param {number[]} [o.speed]   (min, max) m/s
     * @param {number} [o.cone]      how wide the handful opens (0 = a jet, 1 = every way)
     * @param {number[]|null} [o.rgb]  one colour, or null for the fires' own
     * @param {boolean} [o.powder]   snow kicked up instead of sparks
     * @param {number[]} [o.lift]    (min, max) m/s² the sky draws a spark up by
     */
    part.emit = ({
        from, toward = [0, 1, 0], n, rgb = null, time, speed = [1.5, 5], cone = 0.5, life = [2.2, 3.6], size = 0.05,
        glow = 1, stagger = 0, jitter = 0.12, powder = false, lift = [5, 11],
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
            const dy = toward[1] / len + z * cone * 0.8 + 0.1;
            const dz = toward[2] / len + Math.sin(a) * s * cone;
            const dl = Math.hypot(dx, dy, dz) || 1;
            aBirth.set([
                from[0] + (rand() - 0.5) * jitter,
                from[1] + (rand() - 0.5) * jitter,
                from[2] + (rand() - 0.5) * jitter,
                time + rand() * stagger,
            ], i * 4);
            aVel.set([(dx / dl) * v, (dy / dl) * v, (dz / dl) * v, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const c = rgb || FOX_FIRE[Math.floor(rand() * FOX_FIRE.length) % FOX_FIRE.length];
            const g = 0.8 + rand() * 0.4;
            aTint.set([c[0] * g, c[1] * g, c[2] * g, size * (0.65 + rand() * 0.7)], i * 4);
            aKind.set([
                rand(),
                powder ? 1 : 0,
                powder ? -0.35 : lift[0] + (lift[1] - lift[0]) * rand(),
                glow * (0.6 + rand() * 0.8),
            ], i * 4);
        }
        ['aBirth', 'aVel', 'aTint', 'aKind'].forEach((name) => {
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
    const geometry = wQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = wFxMaterial('WinterRowBeams', { depthTest: false });
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
    const vAlong = varying(along, 'wBeamT');
    material.colorNode = Fn(() => {
        const far = clamp(vAlong, 0.0, 1.0);
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(far, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade: a hairline core in a soft sheath that widens as it leaves the card.
        const taper = mix(float(2.2), float(0.8), far);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(far.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.17)).mul(0.34);
        const tip = exp(far.sub(head).mul(far.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(far.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(far).mul(float(1.0).sub(far)).mul(0.9)
                .add(0.1));
        const col = mix(uniforms.color, vec3(1.0), core.mul(0.3));
        return vec4(col.mul(k).mul(2.4), 0.0);
    })();
    const part = wPart('WinterRowBeams', geometry, material, 60);
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

// ── Paw prints ──────────────────────────────────────────────────────────────────

/** Seconds a print takes to drift half full again, and how long one made in firelight glows. */
export const PRINT_FILL = 70;
export const PRINT_GLOW = 7;

/**
 * @param {object} u
 * @param {number} count  prints the snow keeps (the oldest is trodden over)
 */
export function createPrints(u, count) {
    const aPrint = new Float32Array(count * 4);
    const aMade = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aMade[i * 4] = -1000;
    const geometry = wQuadGeometry(count, { aPrint: [aPrint, 4], aMade: [aMade, 4] });
    ['aPrint', 'aMade'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    // (x, y, z, heading) and (time made, glow, size, spare)
    const print = attribute('aPrint', 'vec4');
    const made = attribute('aMade', 'vec4');
    const material = wFxMaterial('WinterPawPrints');
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    const age = u.time.sub(made.x);
    const there = step(0.0, age);
    const c = cos(print.w);
    const s = sin(print.w);
    const span = made.z.mul(there);
    // Flat on the snow, long axis along the fox's heading.
    const lx = positionGeometry.x.mul(span).mul(0.8);
    const lz = positionGeometry.y.mul(span);
    const world = vec3(print.x.add(lx.mul(c)).add(lz.mul(s)), print.y.add(0.035), print.z.sub(lx.mul(s)).add(lz.mul(c)));
    material.vertexNode = wClip(world);
    const vAge = varying(vec3(age, made.y, there), 'wPrintAge');
    // Which way the moon lies across the print, in the print's own frame.
    const moonFlat = normalize(u.moonDir.xz);
    const vMoon = varying(vec2(moonFlat.x.mul(c).sub(moonFlat.y.mul(s)), moonFlat.x.mul(s).add(moonFlat.y.mul(c))), 'wPrintMoon');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const hollow = smoothstep(0.95, 0.35, d);
        // The lip on the far side from the moon catches it; the near wall is in shade.
        const lip = smoothstep(0.55, 0.95, d).mul(smoothstep(1.0, 0.9, d));
        const toward = clamp(q.x.mul(vMoon.x).add(q.y.mul(vMoon.y)).div(max(d, 1e-3)), -1.0, 1.0);
        const filled = exp(max(vAge.x, 0.0).div(-PRINT_FILL)).mul(vAge.z);
        const dark = hollow.mul(toward.mul(0.35).add(0.65)).mul(0.5).mul(filled);
        const bright = lip.mul(max(toward.negate(), 0.0)).mul(0.4).mul(filled);
        const glow = exp(max(vAge.x, 0.0).div(-PRINT_GLOW)).mul(vAge.y).mul(hollow).mul(vAge.z);
        const shadeCol = u.shade.mul(0.55);
        const rgb = shadeCol.mul(dark).add(u.moonCol.mul(bright).mul(0.6))
            .add(mix(u.fire, vec3(1.0), 0.25).mul(glow).mul(1.6));
        return vec4(rgb.mul(u.breath.mul(0.8).add(0.2)), clamp(dark.add(bright.mul(0.3)), 0.0, 1.0));
    })();
    const part = wPart('WinterPawPrints', geometry, material, 6);
    let cursor = 0;
    /** Press a print into the snow. */
    part.press = (x, y, z, heading, time, glow = 0, size = 0.2) => {
        const i = cursor % count;
        cursor += 1;
        aPrint.set([x, y, z, heading], i * 4);
        aMade.set([time, glow, size, 0], i * 4);
        geometry.getAttribute('aPrint').needsUpdate = true;
        geometry.getAttribute('aMade').needsUpdate = true;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aMade[i * 4] = -1000;
        geometry.getAttribute('aMade').needsUpdate = true;
        cursor = 0;
    };
    part.count = count;
    Object.defineProperty(part, 'pressed', { get: () => cursor });
    return part;
}
