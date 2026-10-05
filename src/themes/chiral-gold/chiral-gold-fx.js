/**
 * Chiral Gold — gameplay effects that are their own geometry.
 *
 *  - Sparks: a locking piece strikes gold. Sparks leave the board at the height it landed, and
 *    most of them fly to the nearer tower, corkscrewing in with that tower's hand, to land as the
 *    tower takes the pulse. The rest fall, and skip once on the water.
 *  - Leaf: flakes of gold leaf. Every flake is a little mirror tumbling through the studio's
 *    lights, so it flashes when it happens to face one and is nearly dark otherwise: glitter with
 *    a reason. A clear tears a spiral of it off each tower; a few hundred flakes drift down through
 *    the hall for ever.
 *  - Blades: the cleared rows leave the board as blades of light, each at its own row's height,
 *    and sweep up to strike the towers at the height that row holds on them: a low row near
 *    the water, a high row high up.
 *  - Flares: four-pointed stars where something lands.
 *  - The braid: the four-line strike draws two sets of spiral arms of leaf, one of each hand,
 *    out of the water around the board. They climb through one another, and then the hall rains
 *    gold.
 *  - The tally: the chain's count struck in gold beside the board, stamped larger at each step.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline. Every particle's place is a closed
 * form of the clock and what was written when it was launched.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    mod,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    AURUM,
    TAU,
    cgClip,
    cgFxMaterial,
    cgPart,
    cgQuadGeometry,
    cgStripGeometry,
    mulberry32,
} from './chiral-gold-tsl.js';

// ── Leaf: the shared mirror ─────────────────────────────────────────────────────

/** Where the studio's brightest lights are (world, unit), and how much each one gives a flake. */
const FLAKE_LIGHTS = [
    [[-0.51, 0.559, 0.653], 1.0],
    [[-0.946, 0.309, -0.099], 1.3],
    [[0.907, 0.375, -0.193], 1.1],
    [[0.0, 0.999, 0.035], 0.7],
    [[-0.422, 0.438, -0.794], 0.8],
];

/** How brightly a flat mirror with normal `n` at world point `centre` returns the studio. */
function flakeGlint(n, centre) {
    const V = normalize(cameraPosition.sub(centre));
    let sum = float(0.0);
    FLAKE_LIGHTS.forEach(([dir, gain]) => {
        const H = normalize(vec3(dir[0], dir[1], dir[2]).add(V));
        sum = sum.add(pow(abs(dot(n, H)), 70.0).mul(gain));
    });
    return sum;
}

/** Rodrigues: rotate `v` about unit `axis` by the angle whose cosine and sine are given. */
const rotate = (v, axis, c, s) => v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(c)));

/** A flake's quad corner and normal for tumble seed `seed` and angle `angle`; `size` in metres. */
function flakePose(seed, angle, size, centre, u) {
    const axis = normalize(vec3(cos(seed.mul(TAU)), sin(seed.mul(37.0)).mul(0.7), sin(seed.mul(TAU))));
    const c = cos(angle);
    const s = sin(angle);
    const clip0 = cgClip(centre);
    // Never smaller than a couple of pixels: a distant flake still catches the light.
    const px = size.mul(u.viewport.y).mul(u.lens).div(max(clip0.w, 0.4));
    const grown = size.mul(max(px, 2.1).div(max(px, 1e-3)));
    const corner = vec3(positionGeometry.x.mul(grown), positionGeometry.y.mul(grown).mul(0.72), 0.0);
    return {
        world: centre.add(rotate(corner, axis, c, s)),
        normal: rotate(vec3(0.0, 0.0, 1.0), axis, c, s),
    };
}

const flakeShape = () => {
    const p = uv().sub(0.5).mul(2.0);
    // A torn scrap, not a square: one corner is missing.
    const body = float(1.0).sub(smoothstep(0.72, 1.0, max(abs(p.x), abs(p.y))));
    const torn = smoothstep(1.15, 1.45, p.x.add(p.y).add(2.0));
    return body.mul(torn);
};

export const LEAF_DRAG = 1.5;
export const LEAF_FALL = 0.62;

/**
 * The leaf pool. Slots [0, ambient) drift down through the hall for ever; the rest are a ring of
 * slots events write into.
 * @param {object} u
 * @param {number} count
 * @param {number} ambient
 */
export function createLeaf(u, count, ambient) {
    const aOrigin = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aSpin = new Float32Array(count * 4);
    const aAxis = new Float32Array(count * 4);
    const seedAll = () => {
        const rand = mulberry32(0x1eaf);
        for (let i = 0; i < count; i++) {
            if (i < ambient) {
                // A looping flake: released high in the hall, a different moment for each.
                const period = 17 + rand() * 9;
                aOrigin.set([(rand() - 0.5) * 30, 10.5 + rand() * 1.5, -10 + rand() * 21, -rand() * period], i * 4);
                aVel.set([(rand() - 0.5) * 0.2, 0, (rand() - 0.5) * 0.2, -period], i * 4);
                aSpin.set([rand(), 1.4 + rand() * 3.2, 0.035 + rand() ** 2 * 0.06, (rand() - 0.5) * 0.3], i * 4);
                aAxis.set([aOrigin[i * 4], aOrigin[i * 4 + 2], 0.35 + rand() * 0.5, rand()], i * 4);
            } else {
                aOrigin.set([0, 0, 0, -100], i * 4);
                aVel.set([0, 0, 0, 1], i * 4);
                aSpin.set([0, 0, 0, 0], i * 4);
                aAxis.set([0, 0, 0, 0], i * 4);
            }
        }
    };
    seedAll();
    const geometry = cgQuadGeometry(count, {
        aOrigin: [aOrigin, 4], aVel: [aVel, 4], aSpin: [aSpin, 4], aAxis: [aAxis, 4],
    });
    const names = ['aOrigin', 'aVel', 'aSpin', 'aAxis'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const origin = attribute('aOrigin', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const spin = attribute('aSpin', 'vec4');
    const axis = attribute('aAxis', 'vec4');

    const material = cgFxMaterial('ChiralGoldLeaf');
    const span = max(abs(vel.w), 0.05);
    const loop = step(vel.w, 0.0);
    const since = u.time.sub(origin.w);
    const tau = max(mix(since, mod(since, span), loop), 0.0);
    const alive = step(0.0, since).mul(step(tau, span));
    const seed = spin.x;
    // Thrown, slowed by the air, then falling at a leaf's pace.
    const h = float(1.0).sub(exp(tau.mul(-LEAF_DRAG))).div(LEAF_DRAG);
    const thrown = vec3(origin.x.add(vel.x.mul(h)), origin.y.add(vel.y.mul(h)).sub(tau.sub(h).mul(LEAF_FALL)), origin.z.add(vel.z.mul(h)));
    // Carried round the tower it was torn from, in that tower's hand.
    const ang = spin.w.mul(h);
    const rel = vec2(thrown.x.sub(axis.x), thrown.z.sub(axis.y));
    const ca = cos(ang);
    const sa = sin(ang);
    const grow = smoothstep(0.15, 1.3, tau);
    const centre = vec3(
        axis.x.add(rel.x.mul(ca)).sub(rel.y.mul(sa)).add(sin(tau.mul(2.3).add(seed.mul(40.0))).mul(axis.z).mul(grow)),
        thrown.y.add(sin(tau.mul(3.1).add(seed.mul(11.0))).mul(axis.z).mul(grow).mul(0.25)),
        axis.y.add(rel.x.mul(sa)).add(rel.y.mul(ca)).add(cos(tau.mul(1.9).add(seed.mul(23.0))).mul(axis.z).mul(grow)),
    );
    const pose = flakePose(seed, spin.y.mul(tau).add(seed.mul(50.0)), spin.z, centre, u);
    const fade = smoothstep(0.0, 0.06, tau)
        .mul(float(1.0).sub(smoothstep(span.mul(0.72), span, tau)))
        .mul(smoothstep(0.02, 0.4, centre.y))
        .mul(alive);
    material.vertexNode = cgClip(mix(centre, pose.world, step(0.001, fade)));
    const glint = flakeGlint(pose.normal, centre);
    // Just struck, a flake is still glowing.
    const young = exp(tau.mul(-1.3)).mul(float(1.0).sub(loop));
    const tint = mix(u.alloyA, u.alloyC, axis.w);
    const vLight = varying(
        tint.mul(glint.mul(7.0).add(0.07).add(u.heat.mul(0.08)))
            .add(mix(u.glow, vec3(1.0, 0.92, 0.76), 0.3).mul(young).mul(1.4))
            .mul(fade).mul(u.emit),
        'cgLeaf',
    );
    material.colorNode = Fn(() => vec4(vLight.mul(flakeShape()), 0.0))();

    const part = cgPart('ChiralGoldLeaf', geometry, material, 44, false);
    const pool = count - ambient;
    let cursor = 0;
    let bursts = 0;
    const touch = () => names.forEach((name) => {
        geometry.getAttribute(name).needsUpdate = true;
    });
    /**
     * Tear `n` flakes loose at (x, y, z). They leave along `dir` (unit, or null for every way) at
     * `speed` (min, max), carried round the axis at (axisX, axisZ) by `swirl` radians a second.
     */
    part.emit = ({
        x, y, z, n, time, dir = null, cone = 0.6, speed = [1, 3], life = [3.5, 6], size = [0.04, 0.09],
        swirl = 0, axisX = x, axisZ = z, flutter = [0.2, 0.5], jitter = 0.15, stagger = 0,
    }) => {
        if (pool <= 0) return 0;
        const rand = mulberry32(0x90d + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, pool);
        for (let k = 0; k < total; k++) {
            const i = ambient + (cursor % pool);
            cursor += 1;
            // A random unit vector, pulled toward `dir` when one is given.
            const zr = rand() * 2 - 1;
            const ar = rand() * TAU;
            const rr = Math.sqrt(1 - zr * zr);
            let vx = Math.cos(ar) * rr;
            let vy = zr;
            let vz = Math.sin(ar) * rr;
            if (dir) {
                vx = dir[0] + vx * cone;
                vy = dir[1] + vy * cone;
                vz = dir[2] + vz * cone;
                const l = Math.hypot(vx, vy, vz) || 1;
                vx /= l;
                vy /= l;
                vz /= l;
            }
            const sp = speed[0] + (speed[1] - speed[0]) * rand() ** 1.5;
            aOrigin.set([
                x + (rand() - 0.5) * jitter, y + (rand() - 0.5) * jitter, z + (rand() - 0.5) * jitter, time + rand() * stagger,
            ], i * 4);
            aVel.set([vx * sp, vy * sp, vz * sp, life[0] + (life[1] - life[0]) * rand()], i * 4);
            aSpin.set([
                rand(), (3 + rand() * 7) * (rand() < 0.5 ? -1 : 1), size[0] + (size[1] - size[0]) * rand() ** 2,
                swirl * (0.6 + rand() * 0.8),
            ], i * 4);
            aAxis.set([axisX, axisZ, flutter[0] + (flutter[1] - flutter[0]) * rand(), rand()], i * 4);
        }
        touch();
        return total;
    };
    part.reset = () => {
        seedAll();
        touch();
        cursor = 0;
        bursts = 0;
    };
    part.count = count;
    part.ambient = ambient;
    return part;
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

export const SPARK_GRAVITY = 9.0;
export const SPARK_DRAG = 2.2;

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aAim = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    const clear = () => {
        for (let i = 0; i < count; i++) {
            aBirth.set([0, 0, 0, -100], i * 4);
            aVel.set([0, 0, 0, 1], i * 4);
        }
    };
    clear();
    const geometry = cgQuadGeometry(count, {
        aBirth: [aBirth, 4], aVel: [aVel, 4], aAim: [aAim, 4], aTint: [aTint, 4],
    });
    const names = ['aBirth', 'aVel', 'aAim', 'aTint'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const aim = attribute('aAim', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = cgFxMaterial('ChiralGoldSparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const homes = step(0.5, abs(aim.w));
    const at = (tIn) => {
        const t = clamp(tIn, 0.0, span);
        const h = float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG);
        const drop = t.sub(h).mul(SPARK_GRAVITY / SPARK_DRAG);
        const yFree = birth.y.add(vel.y.mul(h)).sub(drop);
        // One skip on the water.
        const free = vec3(birth.x.add(vel.x.mul(h)), abs(yFree).mul(mix(float(0.3), float(1.0), step(0.0, yFree))).add(0.02), birth.z.add(vel.z.mul(h)));
        // Homing: the same throw without the fall, drawn in to the tower along a corkscrew.
        const k = t.div(max(span, 0.01));
        const w = smoothstep(0.1, 1.0, k);
        const pull = w.mul(w);
        const thrown = vec3(birth.x.add(vel.x.mul(h)), birth.y.add(vel.y.mul(h)), birth.z.add(vel.z.mul(h)));
        const psi = tint.w.mul(900.0).add(aim.w.mul(7.0).mul(k));
        const coil = float(0.85).mul(sin(k.mul(Math.PI))).mul(float(1.0).sub(pull.mul(0.5)));
        const home = mix(thrown, aim.xyz, pull).add(vec3(cos(psi).mul(coil), sin(psi.mul(1.3)).mul(coil).mul(0.35), sin(psi).mul(coil)));
        return mix(free, home, homes);
    };
    // A streak from where the spark was a moment ago to where it is.
    const p1 = at(tau);
    const p0 = at(tau.sub(0.035));
    const along = positionGeometry.x.add(0.5);
    const c0 = cgClip(p0);
    const c1 = cgClip(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const heading = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(heading.y.negate(), heading.x);
    const clip = mix(c0, c1, along);
    const widthPx = max(tint.w.mul(u.viewport.y).mul(u.lens).div(max(clip.w, 0.3)), 1.5).mul(alive);
    const lead = heading.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const age = clamp(tau.div(max(span, 0.01)), 0.0, 1.0);
    // A homing spark burns all the way in; a free one dies as it falls.
    const fade = mix(float(1.0).sub(age).mul(float(1.0).sub(age)), float(1.0).sub(smoothstep(0.85, 1.0, age)), homes);
    const hot = mix(vec3(1.0, 0.95, 0.84), tint.rgb, smoothstep(0.0, 0.4, age));
    const vLight = varying(hot.mul(fade).mul(alive).mul(4.2).mul(u.emit), 'cgSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = cgPart('ChiralGoldSparks', geometry, material, 46, false);
    let cursor = 0;
    let bursts = 0;
    const touch = () => names.forEach((name) => {
        geometry.getAttribute(name).needsUpdate = true;
    });
    /**
     * Throw `n` sparks from (x, y, z) along `dir`. A fraction `homing` of them fly to a point on
     * the tower at (aimX, aimY ± aimSpread, aimZ), corkscrewing with `hand`, and arrive `flight`
     * seconds later.
     */
    part.emit = ({
        x, y, z, n, time, rgb, dir = [0, 1, 0], cone = 0.7, speed = [3, 9], life = [0.5, 1.1], size = 0.03,
        homing = 0, aimX = 0, aimY = 0, aimZ = 0, aimSpread = 0.6, hand = 1, flight = 0.42, jitter = 0.1,
    }) => {
        const rand = mulberry32(0x5a4c + bursts * 7919);
        bursts += 1;
        const total = Math.min(n, count);
        for (let k = 0; k < total; k++) {
            const i = cursor % count;
            cursor += 1;
            const zr = rand() * 2 - 1;
            const ar = rand() * TAU;
            const rr = Math.sqrt(1 - zr * zr);
            let vx = dir[0] + Math.cos(ar) * rr * cone;
            let vy = dir[1] + zr * cone;
            let vz = dir[2] + Math.sin(ar) * rr * cone;
            const l = Math.hypot(vx, vy, vz) || 1;
            const sp = speed[0] + (speed[1] - speed[0]) * rand() ** 1.6;
            vx = (vx / l) * sp;
            vy = (vy / l) * sp;
            vz = (vz / l) * sp;
            const flies = rand() < homing;
            aBirth.set([x + (rand() - 0.5) * jitter, y + (rand() - 0.5) * jitter, z + (rand() - 0.5) * jitter, time], i * 4);
            aVel.set([vx, vy, vz, flies ? flight * (0.82 + rand() * 0.36) : life[0] + (life[1] - life[0]) * rand()], i * 4);
            aAim.set([
                aimX + (rand() - 0.5) * 0.9, aimY + (rand() - 0.5) * 2 * aimSpread, aimZ + (rand() - 0.5) * 0.9,
                flies ? hand : 0,
            ], i * 4);
            const k2 = 0.7 + rand() * 0.6;
            aTint.set([rgb[0] * k2, rgb[1] * k2, rgb[2] * k2, size * (0.6 + rand() * 0.8)], i * 4);
        }
        touch();
        return total;
    };
    part.reset = () => {
        clear();
        touch();
        cursor = 0;
        bursts = 0;
    };
    part.count = count;
    return part;
}

// ── Blades ──────────────────────────────────────────────────────────────────────

export const BLADE_ROWS = 4;
/** Seconds a blade's head takes from the board to the tower, and its afterglow. */
export const BLADE_TRAVEL = 0.14;
export const BLADE_FADE = 0.42;

/**
 * Eight screen-space strips: one from each side of the card for up to four cleared rows. A blade
 * leaves the card level and arrives at the tower level, rising between: an S, not a ruled line.
 */
export function createBlades(u) {
    const count = BLADE_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = cgStripGeometry(count, 28, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** Screen y each of those rows reaches its tower at. */
        ends: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        /** Screen x (fractions) the left and right blades run out to: the towers' near sides. */
        reach: uniform(new THREE.Vector2(0.18, 0.82)),
    };
    const material = cgFxMaterial('ChiralGoldBlades', { depthTest: false });
    const pick = (v) => mix(mix(v.x, v.y, step(0.5, row.x)), mix(v.z, v.w, step(2.5, row.x)), step(1.5, row.x));
    const rowY = pick(uniforms.rows);
    const endY = pick(uniforms.ends);
    const used = step(0.0, rowY).mul(step(0.001, uniforms.frame.w));
    const along = positionGeometry.x.add(0.5);
    const right = step(0.0, row.y);
    const edge = mix(uniforms.frame.x, uniforms.frame.y, right);
    const end = mix(uniforms.reach.x, uniforms.reach.y, right);
    const sx = mix(edge, end, along);
    const thicknessPx = u.viewport.y.mul(0.036);
    const rise = along.mul(along).mul(float(3.0).sub(along.mul(2.0)));
    const sy = mix(rowY, endY, rise).add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'cgBladeT');
    const vStagger = varying(row.x.mul(0.035), 'cgBladeLag');
    material.colorNode = Fn(() => {
        // The rows go one after another, top to bottom, a breath apart.
        const age = u.time.sub(uniforms.frame.z).sub(vStagger);
        const head = age.div(BLADE_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(36.0);
        // A hair-thin white core, tapering as it runs out, inside a gold glow.
        const taper = mix(float(1.6), float(0.55), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate());
        const glow = exp(abs(dy).mul(-0.3)).mul(0.2);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-160.0)).mul(step(head, 1.25)).mul(step(0.0, age));
        const env = exp(max(age.sub(vAlong.mul(BLADE_TRAVEL)), 0.0).div(-BLADE_FADE)).mul(step(0.0, age));
        // The thread it leaves shivers as it fades.
        const shiver = u.noise(vec2(vAlong.mul(3.0).sub(u.time.mul(1.3)), age.mul(0.9))).r.mul(0.7).add(0.5);
        const k = core.add(glow).mul(reached).mul(env).mul(shiver)
            .add(core.add(glow.mul(1.6)).mul(tip).mul(2.4))
            .mul(uniforms.frame.w);
        const col = mix(u.glow, vec3(1.0, 0.95, 0.82), core.mul(0.85));
        return vec4(col.mul(k).mul(3.0).mul(u.emit), 0.0);
    })();
    const part = cgPart('ChiralGoldBlades', geometry, material, 60, false);
    part.uniforms = uniforms;
    /**
     * `ys` = screen y of each cleared row and `ends` = where it meets the towers; `x0`/`x1` = the
     * card's edges; all in screen fractions.
     */
    part.fire = (ys, ends, x0, x1, reachL, reachR, time, strength = 1) => {
        uniforms.rows.value.set(ys[0] ?? -1, ys[1] ?? -1, ys[2] ?? -1, ys[3] ?? -1);
        uniforms.ends.value.set(ends[0] ?? -1, ends[1] ?? -1, ends[2] ?? -1, ends[3] ?? -1);
        uniforms.frame.value.set(x0, x1, time, strength);
        uniforms.reach.value.set(reachL, reachR);
    };
    part.reset = () => {
        uniforms.frame.value.set(0.4, 0.6, -100, 0);
    };
    return part;
}

// ── Flares ──────────────────────────────────────────────────────────────────────

/** Four-pointed stars where something lands. A ring of slots: (x, y, z, birth) + (gain, size, life). */
export function createFlares(u, count = 24) {
    const aFlare = new Float32Array(count * 4);
    const aGain = new Float32Array(count * 4);
    const clear = () => {
        for (let i = 0; i < count; i++) {
            aFlare.set([0, 0, 0, -100], i * 4);
            aGain.set([0, 0, 1, 0], i * 4);
        }
    };
    clear();
    const geometry = cgQuadGeometry(count, { aFlare: [aFlare, 4], aGain: [aGain, 4] });
    geometry.getAttribute('aFlare').setUsage(THREE.DynamicDrawUsage);
    geometry.getAttribute('aGain').setUsage(THREE.DynamicDrawUsage);
    const flare = attribute('aFlare', 'vec4');
    const gain = attribute('aGain', 'vec4');
    const material = cgFxMaterial('ChiralGoldFlares');
    const age = u.time.sub(flare.w);
    const k = clamp(age.div(max(gain.z, 0.01)), 0.0, 1.0);
    const alive = step(0.0, age).mul(step(age, gain.z)).mul(step(0.001, gain.x));
    const clip = cgClip(flare.xyz);
    const half = u.viewport.mul(0.5);
    const sizePx = gain.y.mul(u.viewport.y).mul(u.lens).div(max(clip.w, 0.4)).mul(k.mul(0.5).add(0.75))
        .mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(2.0).mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);
    const env = smoothstep(0.0, 0.06, k).mul(float(1.0).sub(k)).mul(float(1.0).sub(k));
    const vLight = varying(mix(u.glow, vec3(1.0, 0.94, 0.8), 0.6).mul(gain.x).mul(env).mul(alive)
        .mul(u.emit), 'cgFlare');
    material.colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const r = length(p);
        const reach = float(1.0).sub(smoothstep(0.55, 1.0, r));
        const horizontal = exp(abs(p.y).mul(-46.0)).mul(exp(abs(p.x).mul(-2.6)));
        const vertical = exp(abs(p.x).mul(-46.0)).mul(exp(abs(p.y).mul(-3.8))).mul(0.7);
        const core = exp(r.mul(r).mul(-34.0)).mul(1.6);
        const halo = exp(r.mul(-5.5)).mul(0.22);
        return vec4(vLight.mul(horizontal.add(vertical).add(core).add(halo)).mul(reach), 0.0);
    })();
    const part = cgPart('ChiralGoldFlares', geometry, material, 48, false);
    let cursor = 0;
    part.fire = (x, y, z, time, strength = 1, size = 1.2, life = 0.5) => {
        const i = cursor % count;
        cursor += 1;
        aFlare.set([x, y, z, time], i * 4);
        aGain.set([strength, size, life, 0], i * 4);
        geometry.getAttribute('aFlare').needsUpdate = true;
        geometry.getAttribute('aGain').needsUpdate = true;
    };
    part.reset = () => {
        clear();
        geometry.getAttribute('aFlare').needsUpdate = true;
        geometry.getAttribute('aGain').needsUpdate = true;
        cursor = 0;
    };
    part.count = count;
    return part;
}

// ── The braid ───────────────────────────────────────────────────────────────────

/** Spiral arms of each hand, the seconds the water goes on feeding them, and the climb. */
export const BRAID = Object.freeze({
    arms: 3, feed: 1.7, climb: 2.0, height: 8.4, fall: 1.9, radius: 3.4, centreZ: 3.2,
});

/** Height of a braid flake `tau` seconds after it left the water. The CPU twin of the shader. */
export function braidHeight(tau) {
    if (tau <= 0) return 0.15;
    const rise = BRAID.height * (1 - Math.exp(-tau * 0.72));
    const tf = Math.max(tau - BRAID.climb, 0);
    return 0.15 + rise - BRAID.fall * (tf - (1 - Math.exp(-tf * 0.8)) / 0.8);
}

/**
 * @param {object} u
 * @param {number} count
 */
export function createBraid(u, count) {
    const seed = new Float32Array(count * 4);
    const rand = mulberry32(0xb4a1d);
    for (let i = 0; i < count * 4; i++) seed[i] = rand();
    const geometry = cgQuadGeometry(count, { aSeed: [seed, 4] });
    const a = attribute('aSeed', 'vec4');
    const material = cgFxMaterial('ChiralGoldBraid');

    const hand = a.x.sub(0.5).sign();
    const arm = floor(fract(a.x.mul(2.0)).mul(BRAID.arms));
    const since = u.time.sub(u.aurum.x).sub(AURUM.hush).sub(a.y.mul(BRAID.feed));
    const tau = max(since, 0.0);
    const life = a.z.mul(3.0).add(8.0);
    const alive = step(0.0, since).mul(step(tau, life)).mul(step(0.001, u.aurum.y));
    const rise = float(1.0).sub(exp(tau.mul(-0.72))).mul(BRAID.height);
    const tf = max(tau.sub(BRAID.climb), 0.0);
    const fall = tf.sub(float(1.0).sub(exp(tf.mul(-0.8))).div(0.8)).mul(BRAID.fall);
    const y = rise.sub(fall).add(0.15).add(a.w.sub(0.5).mul(0.5));
    // Each arm is fed from its own place on the water; the whole braid turns as it climbs, the two
    // hands in opposite senses, so the arms pass through one another all the way up.
    const turn = u.time.sub(u.aurum.x).mul(0.9);
    const theta = arm.mul(TAU / BRAID.arms)
        .add(pow(tau, 0.85).mul(2.6))
        .add(turn)
        .add(a.w.sub(0.5).mul(0.3))
        .mul(hand);
    const r = a.z.sub(0.5).mul(0.7).add(BRAID.radius)
        .add(sin(tau.mul(1.7).add(a.w.mul(6.0))).mul(0.3))
        .add(tf.mul(0.85));
    const centre = vec3(cos(theta).mul(r), max(y, 0.0), sin(theta).mul(r).mul(0.75).add(BRAID.centreZ));
    const tumble = a.w.mul(5.0).add(3.0).mul(tau).add(a.x.mul(50.0));
    const pose = flakePose(a.y.add(a.z).fract(), tumble, a.w.mul(a.w).mul(0.07).add(0.045), centre, u);
    const fade = smoothstep(0.0, 0.1, tau)
        .mul(float(1.0).sub(smoothstep(life.mul(0.75), life, tau)))
        .mul(smoothstep(0.0, 0.35, y))
        .mul(alive);
    material.vertexNode = cgClip(mix(centre, pose.world, step(0.001, fade)));
    const glint = flakeGlint(pose.normal, centre);
    // Climbing, the leaf is still white hot; falling, it is only a mirror again.
    const hot = exp(tau.mul(-0.75));
    const tint = mix(u.alloyA, u.alloyC, a.y);
    const vLight = varying(
        tint.mul(glint.mul(8.0).add(0.05))
            .add(mix(u.glow, vec3(1.0, 0.92, 0.76), 0.25).mul(hot).mul(1.3))
            .mul(fade).mul(u.aurum.y)
            .mul(u.emit),
        'cgBraid',
    );
    material.colorNode = Fn(() => vec4(vLight.mul(flakeShape()), 0.0))();
    const part = cgPart('ChiralGoldBraid', geometry, material, 45, false);
    part.count = count;
    return part;
}

// ── The tally ───────────────────────────────────────────────────────────────────

/** Glyph cells in the tally atlas: digits 0..9, then the multiplication sign. */
const TALLY_CELLS = 11;
const TALLY_SIGN = 10;
const TALLY_CELL = Object.freeze({ width: 128, height: 160 });

/**
 * Draw the tally's glyphs with the page's own 2D canvas: an italic serif, as a hallmark is cut.
 * Returns null where there is no canvas to draw on (tests, a worker).
 */
export function bakeTallyAtlas(doc = globalThis.document) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    const canvas = doc.createElement('canvas');
    const width = TALLY_CELL.width * TALLY_CELLS;
    const { height } = TALLY_CELL;
    canvas.width = width;
    canvas.height = height;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { willReadFrequently: true }) : null;
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const face = '"Cormorant Garamond", "Playfair Display", Didot, "Bodoni MT", Georgia, "Times New Roman", serif';
    for (let i = 0; i < TALLY_CELLS; i++) {
        const sign = i === TALLY_SIGN;
        ctx.font = `italic 600 ${sign ? 92 : 128}px ${face}`;
        // Each glyph is kept inside its own cell: an italic's overhang must not ink its neighbour.
        ctx.save?.();
        ctx.beginPath?.();
        ctx.rect?.(i * TALLY_CELL.width + 6, 0, TALLY_CELL.width - 12, height);
        ctx.clip?.();
        ctx.fillText(sign ? '\u00d7' : String(i), (i + 0.5) * TALLY_CELL.width, sign ? 114 : 124, TALLY_CELL.width - 24);
        ctx.restore?.();
    }
    const pixels = ctx.getImageData(0, 0, width, height).data;
    // Coverage only, flipped to the texture's bottom-up rows.
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const src = (height - 1 - y) * width * 4;
        const dst = y * width * 4;
        for (let x = 0; x < width; x++) {
            const a = pixels[src + x * 4 + 3];
            data[dst + x * 4] = a;
            data[dst + x * 4 + 1] = a;
            data[dst + x * 4 + 2] = a;
            data[dst + x * 4 + 3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.name = 'chiral-gold-tally';
    tex.needsUpdate = true;
    return tex;
}

/**
 * The chain's count, struck in gold beside the board: "×N". It is stamped larger each time the
 * chain grows and a sheen runs across it. `state` = (count, shown 0..1, punch 0..1, _).
 * @param {object} u
 * @param {THREE.Texture} atlas  from bakeTallyAtlas()
 */
export function createTally(u, atlas) {
    const geometry = cgQuadGeometry(1, {});
    const uniforms = {
        /** World position of the tally's centre, and its height in metres. */
        place: uniform(new THREE.Vector4(-3.6, 7.2, 2, 0.95)),
        state: uniform(new THREE.Vector4(0, 0, 0, 0)),
    };
    const material = cgFxMaterial('ChiralGoldTally', { depthTest: false });
    const shown = uniforms.state.y;
    const punch = uniforms.state.z;
    const clip = cgClip(uniforms.place.xyz);
    const half = u.viewport.mul(0.5);
    const heightPx = uniforms.place.w.mul(u.viewport.y).mul(u.lens).div(max(clip.w, 0.4))
        .mul(punch.mul(0.32).add(1.0))
        .mul(step(0.004, shown));
    // Three cells wide: the sign, tens, units.
    const sizePx = vec2(heightPx.mul((3 * 0.78 * TALLY_CELL.width) / TALLY_CELL.height), heightPx);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(sizePx).div(half).mul(clip.w)), clip.z, clip.w);
    material.colorNode = Fn(() => {
        const st = uv();
        const count = floor(uniforms.state.x.add(0.5));
        const tens = floor(count.div(10.0));
        const units = mod(count, 10.0);
        const two = step(9.5, count);
        // One digit: "×N" centred in two cells. Two digits: all three.
        const cells = two.add(2.0);
        const gx = st.x.sub(float(1.0).sub(cells.div(3.0)).mul(0.5)).mul(3.0);
        const idx = floor(gx);
        const inside = step(0.0, gx).mul(step(gx, cells.sub(0.001)));
        const id = mix(float(TALLY_SIGN), mix(mix(units, tens, two), units, step(1.5, idx)), step(0.5, idx));
        // The glyphs stand closer than their cells: each shows the middle of its own.
        const within = fract(gx).sub(0.5).mul(0.78).add(0.5);
        const cell = vec2(id.add(within).div(TALLY_CELLS), st.y);
        // A fixed mip: the jump in `cell` between glyphs would otherwise pick the coarsest one
        // and rule a line down every boundary.
        const cover = texture(atlas, cell).level(1.0).r.mul(inside);
        // Polished: darker at the foot, a sheen crossing it now and then.
        const sweep = st.x.add(st.y.mul(0.5)).sub(fract(u.time.mul(0.31)).mul(2.6)).add(0.55);
        const sheen = exp(sweep.mul(sweep).mul(-34.0));
        const body = mix(u.alloyB, u.alloyA, st.y).mul(st.y.mul(1.1).add(0.75));
        const rgb = body.mul(2.1)
            .add(vec3(1.0, 0.9, 0.7).mul(sheen).mul(2.4))
            .add(u.glow.mul(punch).mul(2.2))
            .add(u.glow.mul(u.heat).mul(0.9));
        return vec4(rgb.mul(cover).mul(shown).mul(u.emit), 0.0);
    })();
    const part = cgPart('ChiralGoldTally', geometry, material, 62, false);
    part.uniforms = uniforms;
    part.dispose = () => atlas.dispose();
    return part;
}
