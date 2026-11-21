/**
 * Lunara — the sky.
 *
 * One dome, shaded per view direction: the gradient and the great moon's scatter (luSkyBase, the
 * same function every other surface mirrors and fades into), two layers of stars, a band of
 * nebula, the curtains of the aurora, the ringed world far to the right, and what gameplay writes
 * on the sky — halo rings round the great moon (one per step of a chain) and the prismatic ring a
 * four-line clear sends across it.
 *
 * The aurora is three curtains, each a vertical sheet standing on a waving line across the
 * valley. The view ray meets a sheet once, and where it does is solved in closed form (two
 * fixed-point steps on the wave), so a curtain has true perspective — it towers when it is near
 * and lies along the horizon when it is far — with a sharp lower border, rays, and no march.
 *
 * Meteors are a small pool of closed-form streaks on a far shell.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    acos,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    luBell, luFxMaterial, luHash33, luPart, luQuadGeometry, luSkyBase, mulberry32,
} from './lunara-tsl.js';

/** Radius of the dome and of the shell the meteors cross. */
export const SKY_RADIUS = 7000;
/** The most halo rings the great moon wears. */
export const MAX_RINGS = 6;

const BAND_NORMAL = new THREE.Vector3(-0.34, 0.88, 0.36).normalize();
const BAND_ALONG = new THREE.Vector3().crossVectors(BAND_NORMAL, new THREE.Vector3(0, 0, -1)).normalize();

/**
 * @param {object} u  shared valley uniforms
 * @param {object} opts
 * @param {number} opts.curtains  aurora curtains drawn (0..3)
 * @param {boolean} [opts.nebula=true]
 */
export function createSky(u, { curtains = 3, nebula = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraSky';
    material.fog = false;
    material.side = THREE.BackSide;
    // Drawn after everything solid, depth-tested: the dome is only shaded where the sky shows.
    material.depthWrite = false;
    material.depthTest = true;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const up = clamp(dir.y, 0.0, 1.0).toVar();
        const col = luSkyBase(u, dir).toVar();
        const cm = dot(dir, u.moonDir).toVar();
        // Stars and nebula sink into the horizon haze and into the great moon's glare.
        const clearSky = smoothstep(0.02, 0.3, up).mul(float(1.0).sub(smoothstep(0.86, 0.995, cm).mul(0.85))).toVar();

        // ── Nebula: a band of lit dust across the sky ──
        const nightDir = vec3(
            dir.x.mul(u.night.x).sub(dir.z.mul(u.night.y)),
            dir.y,
            dir.z.mul(u.night.x).add(dir.x.mul(u.night.y)),
        ).toVar();
        const b = dot(nightDir, vec3(BAND_NORMAL.x, BAND_NORMAL.y, BAND_NORMAL.z)).toVar();
        const band = exp(b.mul(b).mul(-32.0)).toVar();
        if (nebula) {
            const st = vec2(dot(nightDir, vec3(BAND_ALONG.x, BAND_ALONG.y, BAND_ALONG.z)), b).toVar();
            const c1 = u.noise(st.mul(0.55).add(vec2(0.13, 0.31))).toVar();
            const c2 = u.noise(st.mul(1.7).add(vec2(0.52, 0.07))).toVar();
            const c3 = u.noise(st.mul(4.6).add(vec2(0.29, 0.83))).toVar();
            // Lit clouds with dark sky between them, not a veil over the whole night: a wide
            // threshold for the body, and filaments (ridges of a finer read) at its bright edges.
            const cloud = smoothstep(0.46, 0.9, c1.r.mul(0.62).add(c2.g.mul(0.38))).toVar();
            const filaments = luBell(c3.r.sub(0.5).mul(7.0)).mul(smoothstep(0.2, 0.7, cloud));
            const lanes = smoothstep(0.44, 0.7, c2.r.mul(0.6).add(c1.b.mul(0.4)));
            const tint = mix(u.glow, u.companionCol, smoothstep(0.35, 0.7, c1.g))
                .add(u.auroraLow.mul(smoothstep(0.6, 0.85, c2.b)).mul(0.5));
            const lit = cloud.mul(0.8).add(filaments.mul(0.55));
            col.addAssign(tint.mul(lit).mul(band).mul(float(1.0).sub(lanes.mul(0.85)))
                .mul(0.28)
                .mul(clearSky)
                .mul(u.breath));
        }

        // ── Stars: one per cell of a lattice the sphere of directions cuts through ──
        const pixel = length(fwidth(dir)).toVar();
        const starLayer = (scale, density, size, gain) => {
            const p = nightDir.mul(scale);
            const id = floor(p);
            const h = luHash33(id.add(256.0));
            const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
            const offset = f.sub(nightDir.mul(dot(f, nightDir)));
            const d = length(offset);
            // Never smaller than a pixel: a sub-pixel star would shimmer as the camera drifts.
            const r = max(float(size), pixel.mul(scale).mul(0.8));
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(size).div(r).mul(float(size).div(r)));
            const mag = h.z.mul(h.z).mul(h.z).mul(h.z).mul(0.92)
                .add(0.08);
            const twinkle = sin(u.time.mul(h.y.mul(3.0).add(0.8)).add(h.x.mul(40.0))).mul(0.22).add(0.78);
            const warm = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.82, 0.7), smoothstep(0.55, 1.0, h.y));
            let shape = core;
            if (scale === 64) {
                // Only the brightest first-magnitude stars resolve a tiny diffraction cross.
                const q = offset.xy.div(r);
                const spike = exp(abs(q.x).mul(-7.0).sub(abs(q.y).mul(1.4)))
                    .add(exp(abs(q.y).mul(-7.0).sub(abs(q.x).mul(1.4))));
                shape = core.add(spike.mul(smoothstep(0.90, 1.0, h.z)).mul(0.42));
            }
            return warm.mul(shape.mul(mag).mul(twinkle).mul(step(h.x, density)).mul(gain));
        };
        const stars = starLayer(64.0, 0.45, 0.034, 6.5)
            .add(starLayer(170.0, band.mul(0.5).add(0.34), 0.03, 2.4));
        col.addAssign(stars.mul(clearSky).mul(u.breath.mul(0.5).add(0.5)));

        // ── The ringed world, far off in the haze ──
        const pd = u.planetDir;
        const ex = normalize(cross(vec3(0.0, 1.0, 0.0), pd));
        const ey = cross(pd, ex);
        const ang = u.discs.z;
        const lx = dot(dir, ex).div(ang).toVar();
        const ly = dot(dir, ey).div(ang).toVar();
        const r2 = lx.mul(lx).add(ly.mul(ly)).toVar();
        const aa = pixel.div(ang).mul(1.5);
        If(r2.lessThan(6.25).and(dot(dir, pd).greaterThan(0)), () => {
            const disc = float(1).sub(smoothstep(float(1).sub(aa), float(1).add(aa), sqrt(r2))).toVar();
            const nz = sqrt(max(float(1).sub(r2), 0)).toVar();
            const normal = ex.mul(lx).add(ey.mul(ly)).sub(pd.mul(nz));
            const sunlight = dot(normal, u.sunDir).toVar();
            const tilt = 0.38;
            const rx = lx.mul(Math.cos(tilt)).add(ly.mul(Math.sin(tilt))).toVar();
            const lat = ly.mul(Math.cos(tilt)).sub(lx.mul(Math.sin(tilt))).toVar();
            const ry = lat.div(0.34).toVar();
            const rho = length(vec2(rx, ry)).toVar();
            const belts = lat.add(nz.mul(0.26)).add(sin(rx.mul(6).add(lat.mul(8))).mul(0.035));
            const bands = sin(belts.mul(19).add(sin(belts.mul(9)))).mul(0.17).add(0.55);
            const cloud = mix(vec3(0.13, 0.22, 0.4), vec3(1.0, 0.65, 0.39), bands);
            const ringShade = luBell(lat.add(nz.mul(0.37)).sub(0.12).div(0.17)).mul(0.57);
            const body = cloud.mul(max(sunlight, 0).mul(0.9).add(0.045)).mul(float(1).sub(ringShade))
                .add(u.moonCol.mul(float(1).sub(nz)).mul(smoothstep(-0.1, 0.66, sunlight)).mul(0.38));
            col.assign(mix(col, body.mul(u.breath), disc));
            const gap = smoothstep(0.025, 0.075, abs(rho.sub(1.86)));
            const grooves = sin(rho.mul(52)).mul(0.10).add(0.9).mul(gap);
            const opacity = smoothstep(1.18, 1.32, rho).mul(float(1).sub(smoothstep(2.19, 2.32, rho)))
                .mul(grooves).mul(mix(float(1).sub(disc), float(1), step(ry, 0)));
            // The globe casts a shadow into the far ring; its front arc crosses the opaque globe.
            const ringPos = ex.mul(lx).add(ey.mul(ly)).add(pd.mul(ry.mul(0.94)));
            const alongSun = dot(ringPos, u.sunDir);
            const shadow = smoothstep(0.76, 1.03, length(ringPos.sub(u.sunDir.mul(alongSun))));
            const transmission = mix(float(1), shadow.mul(0.88).add(0.12), step(alongSun, 0));
            const ice = mix(vec3(0.44, 0.31, 0.43), vec3(0.97, 0.78, 0.65), smoothstep(1.28, 1.83, rho))
                .mul(transmission).mul(u.breath).mul(0.78);
            col.assign(mix(col, ice, opacity.mul(0.88)));
        });

        // ── Aurora ──
        if (curtains > 0) {
            // Where this ray is over the plane one unit up: x across, z ahead.
            const slope = max(dir.y, 0.02);
            const qx = dir.x.div(slope).toVar();
            const ahead = max(dir.z.negate().div(slope), 0.02).toVar();
            const drift = u.auroraDrift;
            // A storm deepens the folds.
            const fold = clamp(u.aurora.mul(0.5).add(0.75), 0.8, 1.7).toVar();
            const acc = vec3(0.0).toVar();
            const CURTAINS = [
                // distance, lower border, height, wave amplitude, wave frequency, drift speed, seed, gain
                [30, 8.6, 9.5, 4.8, 0.10, 0.72, 0.0, 1.0],
                [22, 11.2, 10.4, 4.5, 0.13, -0.9, 3.7, 0.78],
                [60, 10.8, 13.0, 9.2, 0.05, 0.5, 8.1, 0.55],
            ];
            for (let i = 0; i < Math.min(curtains, CURTAINS.length); i++) {
                const [D, base, tall, amp, freq, speed, seed, gain] = CURTAINS[i];
                const wave = (x) => sin(x.mul(freq).add(drift.mul(speed)).add(seed))
                    .add(sin(x.mul(freq * 2.7).sub(drift.mul(speed * 1.6)).add(seed * 1.9)).mul(0.42))
                    .mul(fold).mul(amp);
                // The sheet stands on z = −(D + wave(x)); the ray is at (qx·h, −ahead·h) at height h.
                const h0 = float(D).div(ahead);
                const h1 = float(D).add(wave(qx.mul(h0))).div(ahead);
                const h = float(D).add(wave(qx.mul(h1))).div(ahead).toVar();
                const x = qx.mul(h).toVar();
                const sweep = x.mul(0.068 + 0.012 * i).add(drift.mul(0.43 * speed)).add(seed);
                const gather = sin(sweep.add(sin(sweep.mul(1.84).sub(seed)).mul(0.69)))
                    .add(sin(sweep.mul(2.14).add(seed)).mul(0.37));
                const twistFold = sin(sweep.mul(3.6).add(h.mul(0.18))).mul(u.skyEvent.x).mul(2.0);
                const foot = gather.mul(u.night.z.mul(2.75).add(2.2)).add(base).add(twistFold)
                    .add(x.mul(i === 1 ? -0.085 : 0.073));
                const hh = h.sub(foot).div(tall).toVar();
                const above = max(hh, 0.0);
                // A sharp, bright lower border (the hem), a body that thins upward.
                const hem = exp(abs(hh.sub(0.015)).mul(-34.0));
                const profile = smoothstep(-0.035, 0.055, hh).mul(exp(above.mul(-2.6)));
                // Rays at two scales, with dark sky between them: a curtain, not a veil.
                const lean = x.add(above.mul(sin(sweep).mul(2.8).add(2.1)));
                const rays = u.noise(vec2(lean.mul(0.085).add(seed), drift.mul(0.27).add(seed))).g;
                const threads = u.noise(vec2(lean.mul(0.34).add(seed * 2.3), drift.mul(0.61).add(seed))).r;
                const patches = u.noise(vec2(x.mul(0.011).add(drift.mul(0.04 * speed)), seed * 0.37)).r;
                const strands = smoothstep(0.42, 0.82, rays.mul(0.68).add(threads.mul(0.32)));
                // The tallest rays reach highest: a ray's own brightness lifts its top.
                const reachUp = exp(above.mul(-1.6).div(strands.mul(1.4).add(0.35)));
                const patch = smoothstep(0.22, 0.79, patches).mul(0.82).add(0.18);
                const foldLight = gather.mul(0.26).add(0.73);
                const fabric = strands.mul(1.55).add(0.23).mul(reachUp);
                // Low colour in the body; the high colour only in the rays' upper reaches.
                const lower = i === 1 ? mix(u.auroraLow, u.auroraHigh, 0.57) : u.auroraLow;
                const tone = mix(lower, u.auroraHigh, smoothstep(0.035, 0.54, hh).mul(0.94));
                const edge = mix(lower, u.moonCol, u.skyEvent.w.mul(0.65).add(0.10));
                acc.addAssign(tone.mul(profile.mul(fabric)).add(edge.mul(hem).mul(0.7))
                    .mul(patch).mul(foldLight)
                    .mul(gain));
            }
            // The curtains stand ahead of the viewer, and give way round the great moon.
            const reach = step(0.0, dir.z.negate()).mul(float(1.0).sub(smoothstep(0.9, 0.985, cm).mul(0.75)));
            col.addAssign(acc.mul(reach).mul(u.aurora).mul(u.breath).mul(1.82));
        }

        // ── Halo rings round the great moon: one for every step of the chain ──
        const skyAngle = acos(clamp(cm, -1.0, 1.0)).toVar();
        const theta = skyAngle.div(u.discs.x).toVar();
        // The angle round the moon: each ring is lit in arcs that turn slowly, alternately.
        const mx = normalize(cross(vec3(0.0, 1.0, 0.0), u.moonDir));
        const my = cross(u.moonDir, mx);
        const round = atan(dot(dir, my), dot(dir, mx)).toVar();
        If(u.rings.greaterThan(0.002).and(theta.lessThan(2.62)), () => {
            const halo = vec3(0).toVar();
            for (let k = 0; k < MAX_RINGS; k++) {
                const lit = clamp(u.rings.sub(k), 0, 1);
                const at = 1.28 + k * 0.21;
                const turn = (k % 2 === 0 ? 1 : -1) * (0.22 + k * 0.04);
                const phase = round.mul(k % 3 === 0 ? 2 : 3).add(u.auroraDrift.mul(turn * 4)).add(k * 1.7);
                const arcs = smoothstep(-0.85, 0.65, sin(phase));
                const jewel = smoothstep(0.91, 1, sin(phase.add(1.2)));
                const shoulder = luBell(theta.sub(at).div(0.076)).mul(jewel.mul(0.7).add(0.12));
                const line = luBell(theta.sub(at).div(0.018)).add(shoulder);
                const tone = k % 2 === 0 ? u.glow.add(u.moonCol.mul(0.5)) : u.auroraLow.add(u.moonCol.mul(0.3));
                halo.addAssign(tone.mul(line).mul(arcs).mul(lit).mul(1.0 - k * 0.09));
            }
            col.addAssign(halo.mul(u.breath));
        });

        // Back-to-back: two strands of rose plasma connect the bodies in their orbital plane.
        If(u.skyEvent.y.greaterThan(0.012).and(theta.lessThan(2.75)), () => {
            const delta = vec2(dot(u.companionDir, mx), dot(u.companionDir, my)).div(u.discs.x).toVar();
            const length2 = max(dot(delta, delta), 0.001);
            const point = vec2(dot(dir, mx), dot(dir, my)).div(u.discs.x);
            const along = clamp(dot(point, delta).div(length2), 0, 1).toVar();
            const across = dot(point, vec2(delta.y.negate(), delta.x)).div(sqrt(length2));
            const arch = along.mul(float(1).sub(along)).mul(4);
            const spine = across.sub(arch.mul(0.46)).toVar();
            const braid = sin(along.mul(12).sub(u.auroraDrift.mul(1.3))).mul(arch).mul(0.12);
            const strand = luBell(spine.sub(braid).div(0.035)).add(luBell(spine.add(braid).div(0.026)).mul(0.6));
            col.addAssign(u.companionCol.mul(strand.add(luBell(spine.div(0.22)).mul(0.18)))
                .mul(arch).mul(u.skyEvent.y).mul(1.8));
        });
        // A perfect clear uncovers the great moon's corona. A pearly inner limb separates
        // the stone from long, torn streamers, each brightest at a different bearing.
        If(u.skyEvent.z.greaterThan(0.014).and(theta.lessThan(2.5)), () => {
            const h = max(theta.sub(1), 0).toVar();
            const azimuth = round.add(sin(round.mul(3).add(u.auroraDrift.mul(0.18))).mul(h).mul(0.34));
            const filament = sin(azimuth.mul(19).add(sin(azimuth.mul(7)).mul(3.4))).mul(0.5).add(0.5);
            const fan = sin(round.mul(3).add(0.8)).mul(0.5).add(0.5);
            const stream = exp(h.mul(-6.2).div(fan.mul(1.3).add(0.22))).mul(filament.mul(filament));
            const pearl = exp(h.mul(-45)).mul(1.5).add(exp(h.mul(-13)).mul(0.38));
            const corona = mix(u.moonCol, vec3(1.0, 0.74, 0.44), 0.62).mul(pearl)
                .add(mix(u.glow, u.moonCol, fan).mul(stream).mul(0.82));
            col.addAssign(corona.mul(u.skyEvent.z));
        });

        // ── A four-line clear's ring across the sky, split like light through a prism ──
        const age = u.time.sub(u.shock.x);
        const front = age.mul(1.5);
        If(age.greaterThanEqual(0).and(age.lessThan(2.8)), () => {
            const rim = skyAngle.sub(front);
            const prism = u.auroraLow.mul(luBell(rim.add(0.019).div(0.031)))
                .add(u.companionCol.mul(luBell(rim.sub(0.019).div(0.033))))
                .add(u.moonCol.mul(luBell(rim.div(0.012)).mul(0.9).add(luBell(rim.div(0.11)).mul(0.16))));
            col.addAssign(prism.mul(exp(age.mul(-1.3))).mul(u.shock.y));
        });

        return vec4(col, 1.0);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const part = luPart('LunaraSky', geometry, material, -20);
    return part;
}

// ── Meteors ─────────────────────────────────────────────────────────────────────

/** Seconds of sky a meteor's streak covers. */
const METEOR_TAIL = 0.11;

/**
 * A pool of shooting stars. Each is a closed-form streak: born at a point of the sky shell, it
 * runs along its heading and burns out.
 */
export function createMeteors(u, count) {
    const aStart = new Float32Array(count * 4);
    const aRun = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -100;
    const geometry = luQuadGeometry(count, { aStart: [aStart, 4], aRun: [aRun, 4], aTint: [aTint, 4] });
    ['aStart', 'aRun', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const start = attribute('aStart', 'vec4');
    const run = attribute('aRun', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = luFxMaterial('LunaraMeteors', { depthTest: true });
    const tau = u.time.sub(start.w);
    const life = run.w;
    const alive = step(0.0, tau).mul(step(tau, life));
    const at = (t) => cameraPosition.add(start.xyz.add(run.xyz.mul(t)));
    const t1 = clamp(tau, 0.0, life);
    const p1 = at(t1);
    const p0 = at(max(t1.sub(METEOR_TAIL), 0.0));
    const along = positionGeometry.x.add(0.5);
    const proj = (w) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(w, 1.0));
    const c0 = proj(p0);
    const c1 = proj(p1);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dirPx = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dirPx.y.negate(), dirPx.x);
    const clip = mix(c0, c1, along);
    const widthPx = tint.w.mul(u.viewport.y.div(1080.0)).mul(alive);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const k = clamp(tau.div(max(life, 0.01)), 0.0, 1.0);
    const burn = smoothstep(0.0, 0.12, k).mul(float(1.0).sub(smoothstep(0.6, 1.0, k)));
    const vLight = varying(tint.rgb.mul(burn).mul(alive), 'luMeteor');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const head = st.x.mul(st.x).mul(st.x);
        return vec4(vLight.mul(across.mul(across)).mul(head).mul(u.breath), 0.0);
    })();

    const part = luPart('LunaraMeteors', geometry, material, -40);
    let cursor = 0;
    let volleys = 0;
    /**
     * Throw `n` meteors. They cross the sky down and away from `from` (a unit vector, default
     * high on the right), spread over `stagger` seconds.
     */
    part.emit = ({
        n = 1, time, rgb = [1, 1, 1], stagger = 0, from = null, size = 2.2,
    }) => {
        const rand = mulberry32(0x3e7 + volleys * 6151);
        volleys += 1;
        for (let j = 0; j < Math.min(n, count); j++) {
            const i = cursor % count;
            cursor += 1;
            // A start high in the sky, anywhere across the view.
            const az = from ? Math.atan2(from[0], -from[2]) + (rand() - 0.5) * 1.1 : (rand() - 0.5) * 2.0;
            const el = 0.38 + rand() * 0.5;
            const sx = Math.sin(az) * Math.cos(el);
            const sy = Math.sin(el);
            const sz = -Math.cos(az) * Math.cos(el);
            // Headed down and toward the left, where the great moon is.
            const heading = -0.55 - rand() * 0.5;
            const fall = -0.42 - rand() * 0.3;
            const speed = SKY_RADIUS * (0.55 + rand() * 0.45);
            aStart.set([sx * SKY_RADIUS * 0.9, sy * SKY_RADIUS * 0.9, sz * SKY_RADIUS * 0.9, time + rand() * stagger], i * 4);
            aRun.set([heading * speed, fall * speed, (rand() - 0.5) * 0.2 * speed, 0.5 + rand() * 0.45], i * 4);
            const g = 2.2 + rand() * 2.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.7 + rand() * 0.7)], i * 4);
        }
        geometry.getAttribute('aStart').needsUpdate = true;
        geometry.getAttribute('aRun').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -100;
        geometry.getAttribute('aStart').needsUpdate = true;
        cursor = 0;
        volleys = 0;
    };
    part.count = count;
    return part;
}
