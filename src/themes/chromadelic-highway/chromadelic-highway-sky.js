/**
 * Chromadelic Highway — sky dome + deep starfield (with the binary pair).
 *
 * Sky: ONE opaque BackSide dome, drawn after the opaque road (depth test on, so early-Z skips the
 * pixels the road covers). A deep-indigo gradient that is never black, a soft core radiance where
 * the road vanishes behind the card, a rose-violet horizon band, and the nebula — the seamless
 * nebula texture used as DENSITY only, coloured by duotone ramps and placed by direction masks the
 * composition solver aims:
 *   - a glowing magenta-violet emission mass wrapping the hero's night limb (the hero reads as a
 *     silhouette against it), with a teal fringe,
 *   - a teal mass around the ice giant,
 *   - the galactic band with dust lanes from the top-left corner toward the card,
 *   - a calm zone hugging the card (screen space, from the live card rect) and dark void below
 *     the road.
 *
 * Stars: instanced camera-facing quads (THREE.Points is 1 px on WebGPU), after
 * src/themes/starlight/rendering/deep-starfield.js. Three brightness tiers that never straddle the
 * bloom knee, blackbody classes (odyssey-stellar-ramp), density masks (sparse behind the card, rich
 * along the band), a twinkle wave that rolls out from the vanishing point on line clears, and a
 * gold/cyan binary with thin achromatic six-arm spikes. The sky never rotates.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    pow,
    screenUV,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { pickStellarClass } from '../../rendering/odyssey/chapter-environments/odyssey-stellar-ramp.js';
import { chdRoundBoxSdf } from './chromadelic-highway-tsl.js';

const lin = (hex) => new THREE.Color(hex);
const v3 = (c, k = 1) => vec3(c.r * k, c.g * k, c.b * k);
const norm = (r, g, b) => new THREE.Color(r, g, b);

/** Sky palette (scene-linear). Ramp stops are normalised to a max channel of 1. */
export const SKY_PALETTE = Object.freeze({
    zenith: lin('#080516'),
    horizon: lin('#160a2c'),
    nadir: lin('#0a0618'),
    core: lin('#2a1450'),
    warm: [norm(0.49, 0.064, 1), norm(0.744, 0.05, 1), norm(1, 0.159, 0.462)],
    warmFringe: norm(0.054, 0.777, 1),
    cool: [norm(0.048, 0.571, 1), norm(0.015, 0.427, 1), norm(0.06, 0.672, 1)],
    bandGlow: norm(0.575, 0.4, 1),
});

const ramp3 = (x, a, b, c) => mix(mix(a, b, smoothstep(0.25, 0.6, x)), c, smoothstep(0.6, 0.95, x));

/** Rotate a linear colour's hue by `turns` around the grey axis (for palette steps). */
export function rotateHue(color, turns, out = new THREE.Color()) {
    const a = turns * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = (1 - c) / 3;
    const r = Math.sqrt(1 / 3) * s;
    const { r: x, g: y, b: z } = color;
    return out.setRGB(
        Math.max(0, x * (c + k) + y * (k - r) + z * (k + r)),
        Math.max(0, x * (k + r) + y * (c + k) + z * (k - r)),
        Math.max(0, x * (k - r) + y * (k + r) + z * (c + k)),
    );
}

/**
 * @param {object} opts
 * @param {THREE.Texture|null} opts.nebulaMap   seamless nebula (RepeatWrapping); null → no taps
 * @param {number} [opts.taps=2]                 0 (Minimal), 1 (Low) or 2
 * @param {object} opts.shared                   { uViewportPx, uCardRectPx, uCardRadiusPx }
 */
export function createSkyDome({
    nebulaMap = null, taps = 2, radius = 9000, shared,
} = {}) {
    const uTime = uniform(0);
    const uNebBreath = uniform(0);
    const uVpDir = uniform(new THREE.Vector3(0, 0, -1));
    const uWarmDir = uniform(new THREE.Vector3(-0.566, 0.199, -0.8).normalize());
    const uCoolDir = uniform(new THREE.Vector3(0.615, 0.174, -0.769).normalize());
    const uBandNormal = uniform(new THREE.Vector3(0.458, 0.889, 0).normalize());
    const P = SKY_PALETTE;
    const useTaps = nebulaMap ? Math.max(0, Math.min(2, taps)) : 0;
    // Nebula ramp stops are uniforms so a level-up can swing the palette around the wheel.
    const baseStops = [...P.warm, ...P.cool, P.warmFringe];
    const stops = baseStops.map((c) => uniform(new THREE.Color().copy(c)));
    const [uW0, uW1, uW2, uC0, uC1, uC2, uFringe] = stops;
    let appliedShift = 0;

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
    });
    material.name = 'chromadelic-sky';
    material.fog = false;

    material.colorNode = Fn(() => {
        const d = normalize(positionLocal).toVar();
        const e = d.y;
        const tz = max(d.z.negate(), 0.1);
        const tx = d.x.div(tz); // tan(azimuth) proxy, no atan

        // Base gradient: zenith → horizon above, a darker void below the ribbon (branchless).
        const up = mix(v3(P.horizon), v3(P.zenith), smoothstep(0.0, 0.6, e));
        const dn = mix(v3(P.horizon), v3(P.nadir), smoothstep(0.0, -0.3, e));
        const base = mix(dn, up, step(0.0, e)).toVar();
        // Core radiance where the road vanishes (≤ 0.05; peeks out beside the card).
        const c = max(dot(d, uVpDir), 0.0);
        base.addAssign(v3(P.core).mul(pow(c, 7.0).mul(0.6)).mul(smoothstep(0.35, -0.02, e)));
        // Rose-violet horizon band.
        const he = e.sub(0.01).div(0.06);
        const ha = tx.div(1.1);
        base.addAssign(vec3(0.035, 0.008, 0.045).mul(exp(he.mul(he).negate())).mul(exp(ha.mul(ha).negate())));
        if (useTaps === 0) return base;

        // Density from the texture (the max channel is the fair measure across its rainbow hues).
        const suv = d.xy.div(max(tz, 0.18)).mul(0.34);
        const drift = vec2(uTime.mul(0.0016), uTime.mul(-0.0011));
        const s1 = texture(nebulaMap, suv.mul(0.55).add(drift)).rgb;
        const m1 = max(s1.x, max(s1.y, s1.z));
        let dens;
        let dust = float(0.0);
        if (useTaps >= 2) {
            const s2 = texture(nebulaMap, suv.mul(1.35).add(s1.rg.sub(0.5).mul(0.22)).sub(drift.mul(1.7))).rgb;
            const m2 = max(s2.x, max(s2.y, s2.z));
            dens = smoothstep(0.05, 0.62, m1.mul(0.45).add(m2.mul(0.55)));
            dust = smoothstep(0.55, 0.8, m2).mul(smoothstep(0.35, 0.12, m1));
        } else {
            dens = smoothstep(0.05, 0.62, m1);
        }

        // Placement masks (aimed by the composition solver) + the calm zone around the card.
        const warm = exp(dot(d, uWarmDir).sub(1.0).div(0.1));
        const cool = exp(dot(d, uCoolDir).sub(1.0).div(0.035)).mul(0.8);
        const bn = dot(d, uBandNormal);
        const band = exp(bn.mul(bn).mul(-40.0));
        const p = screenUV.mul(shared.uViewportPx);
        const sdf = chdRoundBoxSdf(p, shared.uCardRectPx, shared.uCardRadiusPx);
        const calm = smoothstep(0.0, shared.uViewportPx.y.mul(0.1), sdf);
        const below = smoothstep(-0.2, -0.02, e);

        // Each mass = a smooth emission glow + texture detail on top.
        const nW = warm.mul(dens.mul(0.65).add(0.35)).mul(float(1.0).sub(dust.mul(band).mul(0.6)));
        const nC = cool.mul(dens.mul(0.7).add(0.3));
        const nB = band.mul(dens.mul(0.85).add(0.15)).mul(float(1.0).sub(dust.mul(0.8)));
        const neb = ramp3(nW, uW0, uW1, uW2).mul(0.26).mul(nW).mul(sqrt(nW))
            .add(ramp3(nC, uC0, uC1, uC2).mul(0.14).mul(nC).mul(sqrt(nC)))
            .add(v3(P.bandGlow).mul(0.06).mul(nB))
            .add(uFringe.mul(0.02).mul(warm.mul(float(1.0).sub(warm)).mul(4.0)).mul(dens));
        return base.add(neb.mul(calm).mul(below).mul(float(1.0).add(uNebBreath)));
    })();

    const geometry = new THREE.SphereGeometry(radius, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-sky';
    mesh.frustumCulled = false;
    // Opaque, after the opaque road (renderOrder -10): early-Z rejects the road's pixels.
    mesh.renderOrder = 0;

    return {
        mesh,
        material,
        uniforms: {
            uTime, uNebBreath, uVpDir, uWarmDir, uCoolDir, uBandNormal,
        },
        /** Swing the nebula palette around the wheel (level-ups); a no-op when unchanged. */
        setHueShift(turns) {
            if (Math.abs(turns - appliedShift) < 1e-4) return;
            appliedShift = turns;
            baseStops.forEach((col, i) => rotateHue(col, turns, stops[i].value));
        },
        /** Aim the masks from the composition solver's sky output. */
        setDirections(sky) {
            uWarmDir.value.copy(sky.warmDir);
            uCoolDir.value.copy(sky.coolDir);
            uBandNormal.value.copy(sky.bandNormal);
            uVpDir.value.copy(sky.vpDir);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brightness tiers (scene-linear max channel). No tier straddles the 0.6–1.4 bloom knee even
 * while twinkling, and no static point outshines the hero's crescent by much (cap 1.6).
 */
const STAR_TIERS = [
    {
        share: 0.8, value: [0.06, 0.3], size: [1.3, 1.8], twinkle: 0.18, wave: 0.5,
    },
    {
        share: 0.19, value: [0.32, 0.46], size: [2.0, 3.0], twinkle: 0.06, wave: 0.12,
    },
    {
        share: 0.01, value: [1.45, 1.55], size: [3.0, 4.0], twinkle: 0.03, wave: 0.3,
    },
];
const NEON_PINK = lin('#ff7ad9');
const NEON_CYAN = lin('#7af2ff');
const BINARY_A = lin('#ffb25a');
const BINARY_B = lin('#7fe8ff');
const SHELL_RADIUS = 8000;
const TAN_HALF_REST = Math.tan(THREE.MathUtils.degToRad(30));

/**
 * @param {object} opts
 * @param {number} opts.count                 field stars (the binary adds 2 instances)
 * @param {() => number} opts.random          deterministic RNG
 * @param {THREE.Vector3} [opts.bandNormal]
 * @param {boolean} [opts.spikes=true]        the binary's diffraction spikes (Medium and up)
 */
export function createStarfield({
    count = 3000, random = Math.random, bandNormal, spikes = true,
} = {}) {
    const n = Math.max(1, Math.floor(count));
    const total = n + 2;
    const band = (bandNormal || new THREE.Vector3(0.458, 0.889, 0)).clone().normalize();
    const aA = new Float32Array(total * 4); // dir·R, value
    const aB = new Float32Array(total * 4); // tier, twinkle phase, twinkle freq (rad/s), twinkle amp
    const aC = new Float32Array(total * 4); // rgb, size px
    const dir = new THREE.Vector3();
    const tierCut = STAR_TIERS.reduce((acc, t) => {
        acc.push((acc.length ? acc[acc.length - 1] : 0) + t.share);
        return acc;
    }, []);
    const lerp = (a, b, t) => a + (b - a) * t;

    for (let k = 0; k < n; k++) {
        const i = k + 2; // instances 0 and 1 are the binary pair
        // Rejection-sample the density masks: sparse behind the card, rich along the band,
        // thinner below the horizon.
        let tierIdx = 0;
        const tr = random();
        while (tierIdx < STAR_TIERS.length - 1 && tr > tierCut[tierIdx]) tierIdx++;
        for (let attempt = 0; attempt < 24; attempt++) {
            const az = (random() * 2 - 1) * THREE.MathUtils.degToRad(65);
            const el = THREE.MathUtils.degToRad(-35 + random() * 75);
            dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
            const tanAz = Math.abs(Math.tan(az));
            const bn = dir.dot(band);
            let w = tanAz < 0.2 ? 0.25 : 1;
            w *= 1 + 1.5 * Math.exp(-40 * bn * bn);
            if (el < THREE.MathUtils.degToRad(-3)) w *= 0.5;
            // Bright stars only well clear of the card (|u| > 0.26 at rest).
            if (tierIdx === 2 && tanAz / (2 * TAN_HALF_REST) < 0.26) w = 0;
            if (random() * 2.5 < w) break;
        }
        const t = STAR_TIERS[tierIdx];
        const cls = pickStellarClass(random);
        const col = new THREE.Color(cls.color[0], cls.color[1], cls.color[2]);
        if (random() < 0.1) col.lerp(random() < 0.5 ? NEON_PINK : NEON_CYAN, 0.35);
        // (the random stream order is part of the capture contract: keep draws in this order)
        aA.set([dir.x * SHELL_RADIUS, dir.y * SHELL_RADIUS, dir.z * SHELL_RADIUS,
            lerp(t.value[0], t.value[1], random())], i * 4);
        aB.set([tierIdx, random() * Math.PI * 2, (0.3 + random() * 1.3) * Math.PI * 2, t.twinkle], i * 4);
        aC.set([col.r, col.g, col.b, lerp(t.size[0], t.size[1], random())], i * 4);
    }
    // The binary pair (instances 0 and 1): positions come from uBinaryDir in the vertex stage.
    aB.set([4, 0, 0, 0], 0);
    aC.set([BINARY_A.r, BINARY_A.g, BINARY_A.b, spikes ? 52 : 28], 0);
    aA.set([0, 0, -SHELL_RADIUS, 1.6], 0);
    aB.set([5, Math.PI, 0, 0], 4);
    aC.set([BINARY_B.r, BINARY_B.g, BINARY_B.b, spikes ? 52 : 28], 4);
    aA.set([0, 0, -SHELL_RADIUS, 1.5], 4);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('aStarA', new THREE.InstancedBufferAttribute(aA, 4));
    geometry.setAttribute('aStarB', new THREE.InstancedBufferAttribute(aB, 4));
    geometry.setAttribute('aStarC', new THREE.InstancedBufferAttribute(aC, 4));
    geometry.instanceCount = total;

    const uTime = uniform(0);
    const uViewportH = uniform(1080);
    const uProjScaleY = uniform(1.73);
    const uBinaryDir = uniform(new THREE.Vector3(0.47, 0.37, -0.8).normalize());
    const uBinaryFlare = uniform(0);
    const uWaveOrigin = uniform(new THREE.Vector3(0, 0, -1));
    const uWaveTime = uniform(-100);
    const uWaveBoost = uniform(0);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
    });
    material.name = 'chromadelic-stars';
    material.fog = false;
    material.forceSinglePass = true;

    const tierOf = () => attribute('aStarB', 'vec4').x;
    const worldOf = Fn(() => {
        const a = attribute('aStarA', 'vec4');
        const isBinary = step(3.5, tierOf());
        return mix(a.xyz, uBinaryDir.mul(SHELL_RADIUS), isBinary);
    });

    material.vertexNode = Fn(() => {
        const c = attribute('aStarC', 'vec4');
        const tierIdx = tierOf();
        const vp = cameraViewMatrix.mul(vec4(worldOf(), 1.0)).toVar();
        const dist = vp.z.negate().max(float(0.01));
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        // Binary: ±4.5 px mutual orbit (90 s), A and B opposite.
        const isBinary = step(3.5, tierIdx);
        const sgn = mix(float(1.0), float(-1.0), step(4.5, tierIdx));
        const ang = uTime.mul((Math.PI * 2) / 90);
        const orbit = vec2(cos(ang), sin(ang)).mul(4.5).mul(sgn).mul(isBinary);
        const off = positionLocal.xy.mul(c.w).add(orbit).mul(worldPerPx);
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();

    material.colorNode = Fn(() => {
        const a = attribute('aStarA', 'vec4');
        const b = attribute('aStarB', 'vec4');
        const c = attribute('aStarC', 'vec4');
        const tierIdx = b.x;
        const sizePx = c.w;
        const pxv = positionLocal.xy.mul(sizePx); // pixel offset from the star centre
        const rho = length(pxv);

        // Field stars: a crisp gaussian core (~1 px for faint stars), bright ones a touch wider.
        const sigma = mix(float(0.55), float(1.0), step(1.5, tierIdx));
        const shape = exp(rho.mul(rho).div(sigma.mul(sigma).mul(-2.0)));
        const twinkle = float(1.0).add(b.w.mul(sin(uTime.mul(b.z).add(b.y)))
            .mul(sin(uTime.mul(0.31)).mul(0.08).add(0.92)));
        const value = a.w.mul(twinkle);

        // Twinkle wave from the vanishing point, its gain capped per tier (no knee crossing).
        const dStar = normalize(worldOf().sub(cameraPosition));
        const phase = uTime.sub(uWaveTime).sub(length(dStar.sub(uWaveOrigin)).div(1.6));
        const tierWave = mix(
            mix(float(STAR_TIERS[0].wave), float(STAR_TIERS[1].wave), step(0.5, tierIdx)),
            float(STAR_TIERS[2].wave),
            step(1.5, tierIdx),
        );
        const pulse = exp(phase.mul(phase).mul(-30.0)).mul(min(uWaveBoost, 1.0)).mul(tierWave);
        const fieldCol = mix(c.xyz, v3(NEON_CYAN), pulse.mul(0.5).min(0.25));
        const field = fieldCol.mul(value).mul(shape).mul(float(1.0).add(pulse));

        // Binary: soft cores + halo; thin achromatic six-arm spikes (≤ 24 px) rotated 12°.
        const isBinary = step(3.5, tierIdx);
        const bCore = exp(rho.mul(rho).mul(-0.5));
        // The halo tapers to zero before the quad edge (no square cut-off on low tiers).
        const bHalo = exp(rho.div(-6.0)).mul(0.06).mul(smoothstep(sizePx.mul(0.5), sizePx.mul(0.3), rho));
        let binary = c.xyz.mul(bCore.add(bHalo));
        if (spikes) {
            const arm = (deg) => {
                const ca = Math.cos(THREE.MathUtils.degToRad(deg));
                const sa = Math.sin(THREE.MathUtils.degToRad(deg));
                const along = abs(pxv.x.mul(ca).add(pxv.y.mul(sa)));
                const across = pxv.x.mul(-sa).add(pxv.y.mul(ca));
                return exp(across.mul(across).mul(-1.8)).mul(exp(along.div(-6.0))).mul(smoothstep(20.0, 10.0, along));
            };
            binary = binary.add(vec3(arm(12).add(arm(72)).add(arm(132)).mul(0.16)));
        }
        binary = binary.mul(a.w).mul(float(1.0).add(uBinaryFlare.mul(0.9)));

        const rgb = mix(field, binary, isBinary);
        return vec4(min(rgb, vec3(12.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-stars';
    mesh.frustumCulled = false;
    mesh.renderOrder = -150;

    return {
        mesh,
        material,
        count: n,
        uniforms: {
            uTime, uViewportH, uProjScaleY, uBinaryDir, uBinaryFlare, uWaveOrigin, uWaveTime, uWaveBoost,
        },
        setProjection(viewportHeightPx, projScaleY) {
            if (Number.isFinite(viewportHeightPx) && viewportHeightPx > 0) uViewportH.value = viewportHeightPx;
            if (Number.isFinite(projScaleY) && projScaleY > 0) uProjScaleY.value = projScaleY;
        },
        /** Scale the drawn field (adaptive effect scale); the binary always draws. */
        setDensity(scale) {
            const k = Math.max(0.25, Math.min(1, Number.isFinite(scale) ? scale : 1));
            geometry.instanceCount = 2 + Math.floor(n * k);
        },
        /** Roll a brightness wave out from `origin` (world direction) starting at `time`. */
        triggerWave(time, origin, boost) {
            uWaveTime.value = time;
            uWaveOrigin.value.copy(origin).normalize();
            uWaveBoost.value = boost;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
