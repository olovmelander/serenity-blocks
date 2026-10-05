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

const BAND_NORMAL = new THREE.Vector3(0.46, 0.62, 0.63).normalize();
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
        const b = dot(dir, vec3(BAND_NORMAL.x, BAND_NORMAL.y, BAND_NORMAL.z)).toVar();
        const band = exp(b.mul(b).mul(-14.0)).toVar();
        if (nebula) {
            const st = vec2(dot(dir, vec3(BAND_ALONG.x, BAND_ALONG.y, BAND_ALONG.z)), b).toVar();
            const c1 = u.noise(st.mul(0.55).add(vec2(0.13, 0.31))).toVar();
            const c2 = u.noise(st.mul(1.7).add(vec2(0.52, 0.07))).toVar();
            const cloud = smoothstep(0.38, 0.86, c1.r.mul(0.62).add(c2.g.mul(0.38)));
            const lanes = smoothstep(0.46, 0.72, c2.r.mul(0.6).add(c1.b.mul(0.4)));
            const tint = mix(u.glow, u.companionCol, smoothstep(0.35, 0.7, c1.g))
                .add(u.auroraLow.mul(smoothstep(0.6, 0.85, c2.b)).mul(0.5));
            col.addAssign(tint.mul(cloud).mul(band).mul(float(1.0).sub(lanes.mul(0.75))).mul(0.2)
                .mul(clearSky)
                .mul(u.breath));
        }

        // ── Stars: one per cell of a lattice the sphere of directions cuts through ──
        const pixel = length(fwidth(dir)).toVar();
        const starLayer = (scale, density, size, gain) => {
            const p = dir.mul(scale);
            const id = floor(p);
            const h = luHash33(id);
            const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
            const d = length(f.sub(dir.mul(dot(f, dir))));
            // Never smaller than a pixel: a sub-pixel star would shimmer as the camera drifts.
            const r = max(float(size), pixel.mul(scale).mul(0.8));
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(size).div(r).mul(float(size).div(r)));
            const mag = h.z.mul(h.z).mul(h.z).mul(h.z).mul(0.92)
                .add(0.08);
            const twinkle = sin(u.time.mul(h.y.mul(3.0).add(0.8)).add(h.x.mul(40.0))).mul(0.22).add(0.78);
            const warm = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.82, 0.7), smoothstep(0.55, 1.0, h.y));
            return warm.mul(core.mul(mag).mul(twinkle).mul(step(h.x, density)).mul(gain));
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
        const facing = step(0.0, dot(dir, pd));
        const r2 = lx.mul(lx).add(ly.mul(ly)).toVar();
        const aa = pixel.div(ang).mul(1.5);
        const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), float(1.0).add(aa), sqrt(r2))).mul(facing).toVar();
        const nz = sqrt(max(float(1.0).sub(r2), 0.0));
        const nWorld = ex.mul(lx).add(ey.mul(ly)).sub(pd.mul(nz));
        const lit = smoothstep(-0.08, 0.5, dot(nWorld, u.sunDir));
        const tilt = float(0.42);
        const lat = ly.mul(tilt.cos()).sub(lx.mul(tilt.sin()));
        const bands = sin(lat.mul(8.0).add(sin(lat.mul(21.0)).mul(0.7))).mul(0.5).add(0.5);
        const body = mix(u.glow.mul(0.6).add(u.auroraLow.mul(0.25)), u.companionCol.mul(0.7).add(vec3(0.25)), bands)
            .mul(lit.mul(0.62).add(0.02)).mul(nz.mul(0.5).add(0.5));
        col.assign(mix(col, body.mul(u.breath).add(col.mul(0.6)), disc));
        // Its rings: an ellipse in front of the lower half, behind the upper.
        const rx = lx.mul(tilt.cos()).add(ly.mul(tilt.sin()));
        const ry = ly.mul(tilt.cos()).sub(lx.mul(tilt.sin())).div(0.3);
        const rho = sqrt(rx.mul(rx).add(ry.mul(ry)));
        const grooves = sin(rho.mul(31.0)).mul(0.25).add(0.75).mul(sin(rho.mul(7.0).add(1.0)).mul(0.2).add(0.8));
        const ring = smoothstep(1.32, 1.4, rho).mul(float(1.0).sub(smoothstep(2.2, 2.3, rho))).mul(grooves)
            .mul(facing)
            .mul(mix(float(1.0).sub(disc), float(1.0), step(ry, 0.0)));
        col.addAssign(mix(u.moonCol, u.companionCol, 0.35).mul(ring).mul(0.2).mul(u.breath));

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
                [30, 5.2, 9.5, 2.3, 0.105, 1.0, 0.0, 1.0],
                [17, 5.8, 9.0, 1.5, 0.19, -1.4, 3.7, 0.8],
                [60, 7.0, 14.0, 6.5, 0.05, 0.7, 8.1, 0.8],
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
                const hh = h.sub(base).div(tall).toVar();
                // A sharp lower border, a body that thins upward.
                const profile = smoothstep(0.0, 0.09, hh).mul(exp(max(hh, 0.0).mul(-2.5)).add(exp(max(hh, 0.0).mul(-14.0)).mul(0.45)));
                const rays = u.noise(vec2(x.mul(0.1).add(seed), drift.mul(0.27).add(seed))).g;
                const patches = u.noise(vec2(x.mul(0.011).add(drift.mul(0.04 * speed)), seed * 0.37)).r;
                const fabric = smoothstep(0.24, 0.72, patches).mul(smoothstep(0.2, 0.8, rays).mul(1.1).add(0.3));
                const tone = mix(u.auroraLow, u.auroraHigh, smoothstep(0.04, 0.62, hh));
                acc.addAssign(tone.mul(profile.mul(fabric).mul(gain)));
            }
            // The curtains stand ahead of the viewer, and give way round the great moon.
            const reach = step(0.0, dir.z.negate()).mul(float(1.0).sub(smoothstep(0.9, 0.985, cm).mul(0.75)));
            col.addAssign(acc.mul(reach).mul(u.aurora).mul(u.breath).mul(1.5));
        }

        // ── Halo rings round the great moon: one for every step of the chain ──
        const theta = acos(clamp(cm, -1.0, 1.0)).div(u.discs.x).toVar();
        // The angle round the moon: each ring is lit in arcs that turn slowly, alternately.
        const mx = normalize(cross(vec3(0.0, 1.0, 0.0), u.moonDir));
        const my = cross(u.moonDir, mx);
        const round = atan(dot(dir, my), dot(dir, mx)).toVar();
        const halo = vec3(0.0).toVar();
        for (let k = 0; k < MAX_RINGS; k++) {
            const lit2 = clamp(u.rings.sub(k), 0.0, 1.0);
            const at = 1.3 + k * 0.21;
            const turn = (k % 2 === 0 ? 1 : -1) * (0.22 + k * 0.04);
            const arcs = sin(round.mul(k % 3 === 0 ? 2.0 : 3.0).add(u.time.mul(turn)).add(k * 1.7)).mul(0.42).add(0.58);
            // A hairline with a soft sheath; the newest ring is still drawing itself.
            const line = luBell(theta.sub(at).div(0.022)).add(luBell(theta.sub(at).div(0.11)).mul(0.2));
            const tone = k % 2 === 0 ? u.glow.add(u.moonCol.mul(0.5)) : u.auroraLow.add(u.moonCol.mul(0.3));
            halo.addAssign(tone.mul(line).mul(arcs).mul(lit2).mul(1.0 - k * 0.09));
        }
        col.addAssign(halo.mul(1.25).mul(u.breath));

        // ── A four-line clear's ring across the sky, split like light through a prism ──
        const age = u.time.sub(u.shock.x);
        const front = age.mul(1.5);
        const sky = acos(clamp(cm, -1.0, 1.0));
        const prism = vec3(
            luBell(sky.sub(front).div(0.032)),
            luBell(sky.sub(front.mul(0.975)).div(0.032)),
            luBell(sky.sub(front.mul(0.95)).div(0.032)),
        ).add(luBell(sky.sub(front.mul(0.975)).div(0.12)).mul(0.12));
        col.addAssign(prism.mul(exp(age.mul(-1.3))).mul(step(0.0, age)).mul(u.shock.y).mul(1.1));

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
