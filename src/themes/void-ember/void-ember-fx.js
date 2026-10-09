/**
 * Void Ember — everything that flies.
 *
 *  - The ember wind: sparks the star sheds all the time, like a fire's. They leave the surface
 *    fast, drag to a drift, cool from gold to a dull red and go out; the hotter the star, the
 *    more of them and the further they get. The star's turn lays them into a spiral, and a
 *    T-spin winds that spiral tight.
 *  - Comets: a lock's light leaves the board as a comet in the piece's colour and falls into
 *    the star — a bright head and a tail of motes strung along one arc.
 *  - Sparks: what an impact or a torn-off loop throws. Streaks that leave fast, drag to a halt
 *    and cool. A ring of preallocated slots.
 *  - Shells: a clear's wave as the eye sees it — an arc of plasma leaving the star toward the
 *    board (one front per line), a whole sphere of it for four lines.
 *  - Row beams: the cleared rows leave the card as blades of light at their own heights, drawn
 *    in screen space so they line up with the rows exactly.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
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
    COMET_SLOTS, COMET_TAIL, TAU, WAVE_REACH, WAVE_SHAPE, WAVE_SLOTS, WAVE_TRAVEL, WAVE_FRONT_GAP,
    mulberry32, veBlackbody, veFxMaterial, veHash33, vePart, veQuadGeometry, veWaveLight,
} from './void-ember-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** A turn of `v` about the unit `axis` by the angle whose cosine and sine are given. */
const turnAbout = (v, axis, c, s) => v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1.0).sub(c)));

// ── The ember wind ──────────────────────────────────────────────────────────────

/** How fast a wind ember gives up its first speed. */
export const WIND_DRAG = 2.3;

/** How far (star radii) above the surface an ember is at age fraction `k`, per unit of reach. */
export function windTravel(k) {
    return 1 - Math.exp(-Math.max(0, k) * WIND_DRAG);
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createEmberWind(u, count) {
    const rand = mulberry32(0x7e3b1);
    const aDir = new Float32Array(count * 4);
    const aParam = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const z = rand() * 2 - 1;
        const a = rand() * TAU;
        const r = Math.sqrt(1 - z * z);
        aDir.set([r * Math.cos(a), z, r * Math.sin(a), rand()], i * 4);
        // (reach factor, lives per unit of the wind's clock, size, rank: the lowest ranks burn at rest)
        aParam.set([0.35 + rand() ** 1.7 * 0.9, 0.055 + rand() * 0.075, 0.5 + rand() ** 2 * 1.3, (i + rand()) / count], i * 4);
    }
    const geometry = veQuadGeometry(count, { aDir: [aDir, 4], aParam: [aParam, 4] });
    const dir0 = attribute('aDir', 'vec4');
    const param = attribute('aParam', 'vec4');
    const uniforms = {
        /** How many of the embers burn (0..1) and how far they get (star radii). */
        emit: uniform(0.25),
        reach: uniform(1.6),
        /** World size of one ember. */
        size: uniform(0.036),
    };

    const material = veFxMaterial('VoidEmberWind');
    const cycle = dir0.w.add(u.flow.mul(param.y));
    const life = floor(cycle);
    const k = fract(cycle);
    // Each life leaves from somewhere new.
    const jitter = veHash33(vec3(life, dir0.w.mul(91.7), param.w.mul(53.1))).sub(0.5);
    const from = u.starRot.mul(normalize(dir0.xyz.add(jitter.mul(0.9))));
    const at = (kk) => {
        const rise = float(1.0).sub(exp(kk.mul(-WIND_DRAG))).mul(param.x).mul(uniforms.reach);
        // The star turns under what it has shed, and a T-spin winds the spiral tighter.
        const lag = rise.mul(u.twist.mul(0.5).add(0.22)).negate();
        const swirl = turnAbout(from, u.axis, cos(lag), sin(lag));
        const waver = sin(kk.mul(9.0).add(dir0.w.mul(40.0))).mul(rise).mul(0.035);
        return u.centre.add(swirl.add(cross(u.axis, swirl).mul(waver)).mul(rise.add(1.01)).mul(u.radius));
    };
    const c0 = viewProjection(at(max(k.sub(0.006), 0.0)));
    const c1 = viewProjection(at(k));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const dirS = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dirS.y.negate(), dirS.x);
    const clip = mix(c0, c1, along);
    // The low ranks burn at rest; the rest join as the star is blown up.
    const burning = smoothstep(0.0, 0.06, uniforms.emit.sub(param.w));
    const widthPx = max(uniforms.size.mul(param.z).div(max(clip.w, 1.0).mul(u.pixelAngle)), 1.1).mul(step(1e-3, burning));
    const lead = dirS.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const rise1 = float(1.0).sub(exp(k.mul(-WIND_DRAG))).mul(param.x).mul(uniforms.reach);
    const wave = veWaveLight(u, rise1.add(1.0));
    const cooling = min(u.heat.mul(0.7).add(0.36), 0.92).sub(k.mul(0.8));
    const fade = smoothstep(0.0, 0.03, k).mul(float(1.0).sub(k)).mul(float(1.0).sub(k));
    const flicker = sin(u.time.mul(param.z.mul(7.0).add(5.0)).add(dir0.w.mul(90.0))).mul(0.3).add(0.7);
    const vLight = varying(
        veBlackbody(cooling).mul(pow(max(cooling, 0.05), 1.6).mul(1.5)).mul(fade).mul(flicker)
            .add(wave.rgb.mul(1.6))
            .mul(burning),
        'veWind',
    );
    material.colorNode = Fn(() => {
        const st = uv();
        const across = clamp(float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0)), 0.0, 1.0);
        const tail = smoothstep(0.0, 0.75, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail).mul(u.breath), 0.0);
    })();

    const part = vePart('VoidEmberWind', geometry, material, 30);
    part.uniforms = uniforms;
    part.count = count;
    return part;
}

// ── Comets ──────────────────────────────────────────────────────────────────────

/** How far behind the head the last mote of the tail runs, as a fraction of the flight. */
const COMET_LAG = 0.5;

/** The point of a comet's arc at `s` (0 = the board, 1 = the star). CPU twin of the shader. */
export function cometPoint(from, mid, to, s, out = [0, 0, 0]) {
    const a = (1 - s) * (1 - s);
    const b = 2 * s * (1 - s);
    const c = s * s;
    for (let k = 0; k < 3; k++) out[k] = from[k] * a + mid[k] * b + to[k] * c;
    return out;
}

/** @param {object} u shared uniforms */
export function createComets(u) {
    const count = COMET_SLOTS * COMET_TAIL;
    const aFrom = new Float32Array(count * 4);
    const aMid = new Float32Array(count * 4);
    const aTo = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        // Dormant comets wait far ahead of the camera, never on it.
        aFrom.set([0, 0, -300, -100], i * 4);
        aTo.set([0, 1, 0, 1], i * 4);
        aMid[i * 4 + 3] = (i % COMET_TAIL) / (COMET_TAIL - 1);
    }
    const geometry = veQuadGeometry(count, {
        aFrom: [aFrom, 4], aMid: [aMid, 4], aTo: [aTo, 4], aTint: [aTint, 4],
    });
    const names = ['aFrom', 'aMid', 'aTo', 'aTint'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const mid = attribute('aMid', 'vec4');
    const to = attribute('aTo', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = veFxMaterial('VoidEmberComets', { depthTest: false });
    const lag = mid.w;
    const span = to.w;
    const age = u.time.sub(from.w);
    const raw = age.div(span).sub(lag.mul(COMET_LAG));
    const s = clamp(raw, 0.0, 1.0);
    // It leaves the board gently and falls into the star faster and faster.
    const k = mix(s, s.mul(s), 0.6);
    const a = float(1.0).sub(k).mul(float(1.0).sub(k));
    const b = k.mul(float(1.0).sub(k)).mul(2.0);
    const c = k.mul(k);
    const flutter = sin(u.time.mul(17.0).add(lag.mul(9.0))).mul(lag).mul(0.05);
    // The site it falls on, where the star has carried it NOW.
    const target = u.centre.add(u.starRot.mul(to.xyz).mul(u.radius));
    const middle = from.xyz.add(target).mul(0.5).add(mid.xyz);
    const world = from.xyz.mul(a).add(middle.mul(b)).add(target.mul(c)).add(vec3(0.0, flutter, 0.0));
    const alive = step(0.0, raw).mul(step(raw, 0.999));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    // The head is a coal thrown on the fire; the tail thins to dust.
    const px = u.viewport.y.mul(mix(float(0.019), float(0.0034), lag.sqrt())).mul(tint.w).mul(alive);
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const gain = mix(float(4.2), float(0.7), lag.sqrt()).mul(alive).mul(smoothstep(0.0, 0.06, raw));
    const vLight = varying(mix(tint.rgb, vec3(1.0, 0.94, 0.86), float(0.45).mul(float(1.0).sub(lag))).mul(gain), 'veComet');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const core = exp(d.mul(d).mul(-9.0)).add(exp(d.mul(-5.0)).mul(0.25));
        return vec4(vLight.mul(core).mul(float(1.0).sub(smoothstep(0.75, 1.0, d))).mul(u.iris), 0.0);
    })();

    const part = vePart('VoidEmberComets', geometry, material, 40);
    let cursor = 0;
    /**
     * Send a comet from `from` (a world point) onto `site` (a unit vector in the star's frame),
     * leaving at `time` and taking `flight` seconds. `bow` (a world vector) pulls the middle of
     * the arc aside; `size` scales the comet.
     */
    part.launch = ({
        from: p0, site, rgb, time, flight, bow = [0, 0, 0], size = 1,
    }) => {
        const slot = cursor % COMET_SLOTS;
        cursor += 1;
        for (let j = 0; j < COMET_TAIL; j++) {
            const i = slot * COMET_TAIL + j;
            aFrom.set([p0[0], p0[1], p0[2], time], i * 4);
            aMid.set([bow[0], bow[1], bow[2]], i * 4);
            aTo.set([site[0], site[1], site[2], flight], i * 4);
            aTint.set([rgb[0], rgb[1], rgb[2], size], i * 4);
        }
        names.forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
        return slot;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aFrom[i * 4 + 3] = -100;
        geometry.getAttribute('aFrom').needsUpdate = true;
        cursor = 0;
    };
    part.count = count;
    return part;
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** A spark's drag: it covers (1 − e^(−t·DRAG)) / DRAG seconds of its first speed. */
export const SPARK_DRAG = 1.7;

/** How far a spark has gone `tau` seconds after it left, per unit of speed. CPU twin. */
export function sparkTravel(tau) {
    return (1 - Math.exp(-Math.max(0, tau) * SPARK_DRAG)) / SPARK_DRAG;
}

/**
 * @param {object} u
 * @param {number} count  pool size
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    // Dormant sparks wait far ahead of the camera, never on it.
    for (let i = 0; i < count; i++) aBirth.set([0, 0, -500, -100], i * 4);
    const geometry = veQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    const names = ['aBirth', 'aVel', 'aTint'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = veFxMaterial('VoidEmberSparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => birth.xyz.add(vel.xyz.mul(float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG)));
    // A streak from where the spark was a moment ago to where it is.
    const t = max(tau, 0.0);
    const c0 = viewProjection(at(max(t.sub(0.06), 0.0)));
    const c1 = viewProjection(at(t));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(max(c0.w, 1e-3)).mul(half);
    const s1 = c1.xy.div(max(c1.w, 1e-3)).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const widthPx = max(tint.w.div(max(clip.w, 1.0).mul(u.pixelAngle)), u.viewport.y.mul(0.0013)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK));
    const glitter = sin(t.mul(tint.w.mul(40.0).add(11.0)).add(birth.x.mul(13.0))).mul(0.3).add(0.7);
    // White-hot as it leaves, its own colour for a moment, then an ember's red.
    const own = mix(vec3(1.0, 0.96, 0.9), tint.rgb, smoothstep(0.0, 0.2, ageK));
    const cooled = mix(own, veBlackbody(float(0.42).sub(ageK.mul(0.3))), smoothstep(0.35, 0.95, ageK).mul(0.8));
    const vLight = varying(cooled.mul(fade).mul(glitter).mul(alive).mul(3.2), 'veSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = clamp(float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0)), 0.0, 1.0);
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail).mul(u.breath).mul(u.iris), 0.0);
    })();

    const part = vePart('VoidEmberSparks', geometry, material, 35);
    let cursor = 0;
    let bursts = 0;
    /**
     * Throw `n` sparks from a world point at `time` (which may be a moment ahead). They leave
     * round `dir` (a world unit vector) within `spread` (0 = a jet, 1 = a hemisphere, 2 = every
     * way) at `out` = (min, max) speed.
     */
    part.emit = ({
        x, y, z, n, rgb, time, dir: d = [0, 1, 0], spread = 1, out = [6, 26], life = [0.7, 1.6], size = 0.2,
        stagger = 0, scatter = 0,
    }) => {
        const rand = mulberry32(0x51a7 + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        for (let j = 0; j < total; j++) {
            const i = cursor % count;
            cursor += 1;
            // A random unit vector, pulled toward `d`.
            const zz = rand() * 2 - 1;
            const aa = rand() * TAU;
            const rr = Math.sqrt(1 - zz * zz);
            let vx = rr * Math.cos(aa) * spread + d[0];
            let vy = zz * spread + d[1];
            let vz = rr * Math.sin(aa) * spread + d[2];
            const vl = Math.hypot(vx, vy, vz) || 1;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.6;
            vx = (vx / vl) * speed;
            vy = (vy / vl) * speed;
            vz = (vz / vl) * speed;
            aBirth.set([
                x + (rand() - 0.5) * scatter, y + (rand() - 0.5) * scatter, z + (rand() - 0.5) * scatter,
                time + rand() * stagger,
            ], i * 4);
            aVel.set([vx, vy, vz, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const g = 0.7 + rand() * 0.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.55 + rand() * 0.9)], i * 4);
        }
        names.forEach((name) => {
            geometry.getAttribute(name).needsUpdate = true;
        });
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

// ── Shells ──────────────────────────────────────────────────────────────────────

/** How many star radii the shells' sheet reaches. */
const SHELL_REACH = 15;
/** Seconds a shell is drawn for. */
export const SHELL_LIFE = 3.4;

/** @param {object} u shared uniforms */
export function createShells(u) {
    const aIndex = new Float32Array(WAVE_SLOTS);
    for (let i = 0; i < WAVE_SLOTS; i++) aIndex[i] = i;
    const geometry = veQuadGeometry(WAVE_SLOTS, { aIndex: [aIndex, 1] });
    const index = attribute('aIndex', 'float');
    const material = veFxMaterial('VoidEmberShells');

    const row = int(index.add(0.5)).mul(3);
    const A = u.waves.element(row);
    const B = u.waves.element(row.add(1));
    const C = u.waves.element(row.add(2));
    const age = u.time.sub(A.x);
    const alive = step(0.0, age).mul(step(age, SHELL_LIFE)).mul(step(0.001, A.y));
    const viewCentre = cameraViewMatrix.mul(vec4(u.centre, 1.0)).xyz;
    const size = u.radius.mul(SHELL_REACH * 2).mul(alive);
    material.vertexNode = cameraProjectionMatrix.mul(vec4(viewCentre.add(vec3(positionGeometry.xy.mul(size), 0.0)), 1.0));

    const vA = varying(A, 'veShellA');
    const vB = varying(B, 'veShellB');
    const vC = varying(C, 'veShellC');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(SHELL_REACH * 2).toVar();
        const b = max(length(q), 1e-4).toVar();
        const dir = q.div(b).toVar();
        const since = u.time.sub(vA.x).toVar();
        // Torn, not ruled: the front runs ahead here and lags there, the same way all the way out.
        const grain = u.noise3(vec3(dir.mul(4.2), vA.x.mul(0.37))).toVar();
        const hair = u.noise3(vec3(dir.mul(15.0), b.mul(0.5).add(vA.x))).toVar();
        const ragged = grain.y.sub(0.5).mul(0.07).add(hair.y.sub(0.5).mul(0.025)).add(1.0);
        const light = float(0.0).toVar();
        for (let k = 0; k < 4; k++) {
            const t = max(since.sub(k * WAVE_FRONT_GAP), 0.0);
            const radius = float(1.0).add(float(WAVE_REACH).mul(pow(min(t.div(WAVE_TRAVEL), 1.6), WAVE_SHAPE))).mul(ragged);
            const thick = vA.w.mul(radius.mul(0.009).add(0.035));
            const x = b.sub(radius).div(thick);
            // A thin bright rim with the shell's own glow trailing inside it.
            // A hard leading edge, and the shocked plasma trailing behind it.
            const rim = exp(x.mul(x).negate()).mul(step(0.0, x))
                .add(exp(min(x, 0.0).mul(0.8)).mul(step(x, 0.0)));
            light.addAssign(rim.div(radius.mul(0.32).add(0.68)).mul(step(k + 0.5, vA.z)).mul(step(k * WAVE_FRONT_GAP, since)));
        }
        const filaments = grain.x.mul(grain.x).mul(1.5).add(hair.x.mul(0.5)).add(0.2);
        // An arc toward the board for a small clear; the whole circle for a great one.
        const window = smoothstep(-0.3, 0.3, dot(dir, vC.xy).sub(cos(vB.w.mul(Math.PI)))).toVar();
        window.assign(mix(window, float(1.0), step(0.985, vB.w)));
        const fade = exp(since.div(-1.25)).mul(float(1.0).sub(smoothstep(SHELL_LIFE * 0.6, SHELL_LIFE, since)));
        // White-hot as it leaves, its own fire as it crosses the frame, an ember's red as it thins.
        const fire = mix(vec3(1.0, 0.93, 0.8), vB.rgb, smoothstep(0.0, 0.3, since));
        const hot = mix(fire, vB.rgb.mul(vec3(1.0, 0.5, 0.26)), smoothstep(0.5, 2.4, since));
        return vec4(hot.mul(light.mul(filaments).mul(window).mul(fade).mul(vA.y)
            .mul(1.25)
            .mul(u.iris.sqrt())), 0.0);
    })();
    const part = vePart('VoidEmberShells', geometry, material, 45);
    part.count = WAVE_SLOTS;
    return part;
}

// ── Row beams ───────────────────────────────────────────────────────────────────

export const BEAM_ROWS = 4;
/** Seconds a beam's head takes from the card to the edge of the frame, and its afterglow. */
export const BEAM_TRAVEL = 0.14;
export const BEAM_FADE = 0.18;
/** How far toward the edge of the frame a beam reaches (a fraction of the way). */
export const BEAM_REACH = 0.62;

/** Eight screen-space strips: one from each side of the card for up to four cleared rows. */
export function createRowBeams(u) {
    const count = BEAM_ROWS * 2;
    const aRow = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) aRow.set([Math.floor(i / 2), i % 2 ? 1 : -1], i * 2);
    const geometry = veQuadGeometry(count, { aRow: [aRow, 2] });
    const row = attribute('aRow', 'vec2');
    const uniforms = {
        /** Screen y (fractions, y down) of up to four rows; < 0 = unused. */
        rows: uniform(new THREE.Vector4(-1, -1, -1, -1)),
        /** (card x0, card x1, birth time, strength) */
        frame: uniform(new THREE.Vector4(0.4, 0.6, -100, 0)),
        color: uniform(new THREE.Vector3(1, 1, 1)),
    };
    const material = veFxMaterial('VoidEmberRowBeams', { depthTest: false });
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
    const sx = mix(edge, mix(edge, end, BEAM_REACH), along);
    const thicknessPx = float(46.0);
    const sy = rowY.add(positionGeometry.y.mul(thicknessPx).div(u.viewport.y));
    material.vertexNode = vec4(sx.mul(2.0).sub(1.0).mul(used), float(1.0).sub(sy.mul(2.0)).mul(used), 0.0, 1.0);
    const vAlong = varying(along, 'veBeamT');
    material.colorNode = Fn(() => {
        const age = u.time.sub(uniforms.frame.z);
        const head = age.div(BEAM_TRAVEL);
        const reached = step(vAlong, head);
        const dy = uv().y.sub(0.5).mul(thicknessPx);
        // A blade: a hairline core in a soft sheath that widens as it leaves the card.
        const taper = mix(float(3.2), float(0.8), vAlong);
        const core = exp(dy.mul(dy).div(taper.mul(taper)).negate()).mul(float(1.0).sub(vAlong.mul(0.8)));
        const sheath = exp(abs(dy).mul(-0.24)).mul(0.22);
        const tip = exp(vAlong.sub(head).mul(vAlong.sub(head)).mul(-150.0)).mul(step(head, 1.25));
        const env = exp(max(age.sub(vAlong.mul(BEAM_TRAVEL)), 0.0).div(-BEAM_FADE)).mul(step(0.0, age));
        const k = core.add(sheath).mul(reached).mul(env).add(core.add(sheath).mul(tip).mul(2.2))
            .mul(uniforms.frame.w)
            .mul(float(1.0).sub(vAlong).mul(float(1.0).sub(vAlong)));
        const col = mix(uniforms.color, vec3(1.0, 0.95, 0.86), core.mul(0.3));
        return vec4(col.mul(k).mul(1.7).mul(u.iris), 0.0);
    })();
    const part = vePart('VoidEmberRowBeams', geometry, material, 60);
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
