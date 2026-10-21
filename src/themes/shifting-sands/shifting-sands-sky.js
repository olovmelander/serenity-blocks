/**
 * Shifting Sands — the sky dome: one opaque BackSide sphere shaded per pixel by view direction.
 *
 *  - the shared atmosphere gradient (hot apricot band toward the suns → dusty rose away from
 *    them → violet upper sky → deep blue zenith) and the suns' Mie glow;
 *  - faint crepuscular rays fanning from the primary sun;
 *  - high cirrus on an altitude plane, in wisps gathered into drifts (a slow warp bends the
 *    fibres), lit gold-pink from below near the suns and dusky mauve away from them;
 *  - dust bars: thin strata of high dust low over the suns' bearing, dark against the suns' own
 *    glow with a burning edge, rose-gold further out; the sinking ember passes down behind them;
 *  - the twin suns: an ember-gold primary whose heart passes the tone curve's whitening point and
 *    whose rim melts into its glow (lower limb reddened, squashed a little by refraction, veiled
 *    where a dust bar crosses it), and a white-hot companion;
 *  - the two moons: shaded spheres lit by the primary sun (thick crescents, the dark
 *    limb faintly lit by dust-glow), veiled by the haze;
 *  - stars that surface as the dusk deepens (one hash per pixel cell, no extra draw).
 *
 * Drawn after the opaque world (renderOrder) with depthWrite off, so early-z rejects every pixel
 * the dunes, rocks and worm already cover: the sky only pays for the sky it shows.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    cameraPosition,
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
    positionWorld,
    smoothstep,
    sqrt,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { ssHash21, ssPhaseHG, ssTexNoise } from './shifting-sands-tsl.js';

export const SKY_RADIUS = 20000;

/**
 * The suns' own discs (scene-linear). The ember's heart is bright enough to pass the tone curve's
 * whitening point (it reads cream-gold) while its rim falls to an orange that melts into the glow.
 */
const SUN_A_CORE = vec3(1.0, 0.62, 0.2);
const SUN_A_LIMB = vec3(1.0, 0.4, 0.09);
const SUN_A_POWER = 12.0;
const SUN_B_CORE = vec3(1.0, 0.9, 0.74);
const SUN_B_POWER = 22.0;

/** Bearing (radians) the dust bars gather over: between the two suns. */
const SUN_BEARING = (-28.5 * Math.PI) / 180;
const DUST_BARS_SPAN = (34 * Math.PI) / 180;
/** el: sine of the bar's height; half: its half-thickness; wob: how far it wavers; gap: where it breaks. */
const DUST_BARS = Object.freeze([
    {
        el: 0.066, half: 0.0085, wob: 0.008, gap: 0.36, dens: 0.72,
    },
    {
        el: 0.118, half: 0.0055, wob: 0.012, gap: 0.46, dens: 0.58,
    },
]);

/** A shaded moon disc at direction M with angular radius r (radians). Returns vec4(rgb, mask). */
function moonDisc(dir, M, r, uSunA, noiseTex, seed) {
    const c = dot(dir, M);
    const perp = dir.sub(M.mul(c));
    const t = perp.div(r);
    const t2 = dot(t, t);
    const edge = fwidth(t2).add(1e-4);
    const mask = float(1.0).sub(smoothstep(float(1.0).sub(edge.mul(1.5)), float(1.0).add(edge), t2))
        .mul(smoothstep(0.0, 0.2, c));
    const n = normalize(t.sub(M.mul(sqrt(max(float(1.0).sub(t2), 0.0)))));
    const lit = clamp(dot(n, uSunA).mul(1.6), 0.0, 1.0);
    // Maria: two noise channels on the disc.
    const m = ssTexNoise(noiseTex, t.xy.add(t.z).mul(2.6).add(seed));
    const maria = smoothstep(0.35, 0.65, m.x.mul(0.7).add(m.y.mul(0.3)));
    const albedo = mix(vec3(0.62, 0.55, 0.48), vec3(0.86, 0.8, 0.7), maria);
    const limb = mix(0.75, 1.0, sqrt(max(float(1.0).sub(t2), 0.0)));
    const col = albedo.mul(lit.mul(limb).mul(1.9).add(0.02));
    return vec4(col, mask);
}

/**
 * @param {object} shared world uniforms + atmosphere + noise texture
 * @param {object} opts
 * @param {boolean} [opts.clouds=true]
 * @param {boolean} [opts.stars=true]
 * @param {THREE.Vector3} opts.moonA / opts.moonB directions; opts.moonRadA/moonRadB (radians)
 * @param {number} opts.sunRadA / opts.sunRadB  angular radii (radians)
 */
export function createSky(shared, opts) {
    const {
        uTime, uSunA, uSunB, uSunLightA, uSunLightB, uDusk, uSunFlare, atmosphere, noiseTex, uWindDir,
    } = shared;
    const clouds = opts.clouds !== false;
    const stars = opts.stars !== false;
    const { uMoonA } = opts;
    const { uMoonB } = opts;
    const { sunRadA } = opts;
    const { sunRadB } = opts;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    material.name = 'shifting-sands-sky';
    material.fog = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const el = dir.y;
        const col = atmosphere.skyGradient(dir).toVar();

        // ── Crepuscular rays: an angular modulation of the primary sun's glow ──
        const right = normalize(cross(uSunA, vec3(0.0, 1.0, 0.0)));
        const upv = cross(right, uSunA);
        const tp = dir.sub(uSunA.mul(dot(dir, uSunA)));
        const ang = atan(dot(tp, upv), dot(tp, right));
        const rayN = ssTexNoise(noiseTex, vec2(ang.mul(9.0), uTime.mul(0.015)));
        const rays = rayN.x.mul(0.65).add(rayN.y.mul(0.35));
        const cA = dot(dir, uSunA);
        const rayFall = smoothstep(0.93, 0.997, cA).mul(smoothstep(-0.04, 0.05, el))
            .mul(float(1.0).sub(smoothstep(0.1, 0.3, el)));
        col.addAssign(uSunLightA.mul(smoothstep(0.35, 0.85, rays).mul(rayFall).mul(0.035)));

        // ── Stars (deepening dusk) ──
        if (stars) {
            const sp = vec2(atan(dir.x, dir.z.negate()), el).mul(vec2(160.0, 160.0));
            const cell = floor(sp);
            const h = ssHash21(cell);
            const off = vec2(ssHash21(cell.add(7.7)), ssHash21(cell.add(13.1))).mul(0.6).add(0.2);
            const fw = fwidth(sp.x).add(fwidth(sp.y)).mul(0.5);
            const dotS = float(1.0).sub(smoothstep(fw.mul(0.5), fw.mul(1.4), length(fract(sp).sub(off))));
            const bright = smoothstep(0.985, 1.0, h).mul(smoothstep(0.08, 0.5, el));
            const tw = float(0.75).add(float(0.25).mul(fract(h.mul(91.7).add(uTime.mul(0.6))).sub(0.5).abs().mul(2.0)));
            col.addAssign(vec3(0.9, 0.92, 1.0).mul(dotS.mul(bright).mul(tw).mul(uDusk.mul(0.9).add(0.12)).mul(1.4)));
        }

        // ── Moons (veiled by the lower atmosphere) ──
        const veil = smoothstep(0.02, 0.45, el).mul(0.55).add(0.25).mul(mix(0.75, 1.15, uDusk));
        const mA = moonDisc(dir, uMoonA, opts.moonRadA, uSunA, noiseTex, vec2(3.1, 7.4));
        const mB = moonDisc(dir, uMoonB, opts.moonRadB, uSunA, noiseTex, vec2(11.7, 2.9));
        col.assign(mix(col, col.mul(0.82).add(mA.xyz.mul(veil)), mA.w));
        col.assign(mix(col, col.mul(0.82).add(mB.xyz.mul(veil)), mB.w));

        // ── High cirrus on an altitude plane ──
        // A slow warp bends the fibres and a slow mask gathers them into drifts: unbent fibres
        // streaming toward the suns line up as a comb of ruled strokes.
        if (clouds) {
            const q = dir.xz.div(el.add(0.1)).toVar();
            const drift = uTime.mul(0.006);
            const along = dot(q, uWindDir);
            const across = dot(q, vec2(uWindDir.y.negate(), uWindDir.x));
            const slow = ssTexNoise(noiseTex, vec2(along.mul(0.22), across.mul(0.45)).add(vec2(drift.mul(0.3), 3.1)));
            const bent = across.add(slow.x.sub(0.5).mul(3.2));
            const at = vec2(along.mul(1.3).add(drift), bent.mul(5.0));
            const fibre = ssTexNoise(noiseTex, at.add(vec2(4.3, 1.7)));
            const comb = ssTexNoise(noiseTex, at.mul(vec2(2.6, 3.2)).add(vec2(fibre.z.mul(0.9), 9.2)));
            // Wisps: the streets break into lengths, each fraying out at its ends.
            const lengths = ssTexNoise(noiseTex, vec2(along.mul(0.55), bent.mul(1.4)).add(vec2(11.0, 2.0)));
            const wisps = smoothstep(0.3, 0.68, lengths.w);
            const drifts = smoothstep(0.34, 0.7, slow.z);
            const dens = smoothstep(0.48, 0.84, fibre.x.mul(0.66).add(comb.y.mul(0.34))).mul(drifts).mul(wisps).toVar();
            dens.mulAssign(smoothstep(0.025, 0.14, el).mul(float(1.0).sub(smoothstep(0.5, 0.88, el))));
            // Lit from below by the low suns: a gold-rose underside toward them, mauve away.
            const fwdA = ssPhaseHG(cA, float(0.72));
            const fwdB = ssPhaseHG(dot(dir, uSunB), float(0.75));
            const toward = atmosphere.towardSunA(dir);
            const rim = uSunLightA.mul(fwdA.mul(0.12).add(mix(0.03, 0.07, toward)))
                .add(uSunLightB.mul(fwdB.mul(0.05)));
            const dusky = mix(vec3(0.24, 0.16, 0.24), vec3(0.44, 0.24, 0.22), toward);
            // Thick fibres are brighter at heart; thin ones are only veil.
            const body = mix(0.6, 1.1, smoothstep(0.55, 0.95, fibre.x));
            const cloudCol = dusky.mul(0.5).add(rim.mul(body).mul(mix(0.7, 1.0, comb.x)));
            col.assign(mix(col, cloudCol, dens.mul(0.62)));
        }

        // ── Dust bars: a few thin strata of high dust over the suns' bearing, lit from behind ──
        // They hang at fixed heights, so the sinking ember (the level dusk) passes down behind them.
        const barCover = float(0.0).toVar();
        if (clouds) {
            const bearing = atan(dir.x, dir.z.negate());
            const fromSuns = bearing.sub(SUN_BEARING).div(DUST_BARS_SPAN).toVar();
            const reach = exp(fromSuns.mul(fromSuns).negate());
            const drift = uTime.mul(0.0035);
            const bn = ssTexNoise(noiseTex, vec2(bearing.mul(22.0).add(drift.mul(6.0)), 5.0));
            const bl = ssTexNoise(noiseTex, vec2(bearing.mul(7.0).add(drift), 19.0));
            for (let i = 0; i < DUST_BARS.length; i++) {
                const b = DUST_BARS[i];
                // Each bar wavers in height and thickness and breaks into long lengths.
                const wob = bn.x.sub(0.5).mul(b.wob);
                const thick = float(b.half).mul(bn.y.mul(0.8).add(0.5));
                const cut = smoothstep(b.gap, b.gap + 0.22, i === 0 ? bl.x : bl.z);
                const across = abs(el.sub(b.el).sub(wob)).div(thick);
                const bar = float(1.0).sub(smoothstep(0.1, 1.0, across)).mul(cut).mul(reach)
                    .mul(b.dens);
                barCover.assign(max(barCover, bar));
            }
            // Against the suns' own glow a bar is a dark band with a burning edge; further out the
            // low light catches its underside and it glows rose-gold.
            const against = smoothstep(0.985, 0.9996, cA);
            const edge = barCover.mul(float(1.0).sub(barCover)).mul(4.0);
            const glowA = ssPhaseHG(cA, float(0.86)).mul(0.06).add(ssPhaseHG(dot(dir, uSunB), float(0.8)).mul(0.02));
            const barCol = col.mul(mix(1.4, 0.5, against)).mul(vec3(1.0, 0.84, 0.8))
                .add(uSunLightA.mul(glowA.mul(edge.mul(1.5).add(0.25))));
            col.assign(mix(col, barCol, barCover.mul(0.85)));
        }

        // ── The twin suns ──
        // A is low in the thick air: an ember disc, its rim dark red (blue darkens fastest toward
        // the limb), its lower limb redder and dimmer still, squashed a little by refraction, and
        // crossed by the dust bars. B is higher and white-hot. Each disc's own colour is authored
        // with its green low: the shared sun light is the colour the SAND takes, too pale for a disc.
        const lA = vec2(dot(tp, right), dot(tp, upv)).div(sunRadA).toVar();
        const rA = length(vec2(lA.x, lA.y.div(0.965)));
        const pxA = fwidth(rA).add(1e-5);
        // (The front hemisphere only: the disc's coordinates repeat at the antipode.)
        const discA = float(1.0).sub(smoothstep(float(1.0).sub(pxA), float(1.0).add(pxA), rA))
            .mul(smoothstep(-0.2, 0.2, cA));
        const muA = sqrt(max(float(1.0).sub(rA.mul(rA)), 0.0));
        const darkA = vec3(1.0).sub(vec3(0.5, 0.56, 0.64).mul(float(1.0).sub(muA)));
        const heartA = mix(SUN_A_LIMB, SUN_A_CORE, smoothstep(0.3, 1.0, muA));
        const lowLimb = smoothstep(0.35, -1.0, lA.y).mul(uDusk.mul(0.25).add(0.55));
        const ember = mix(vec3(1.0), vec3(0.78, 0.5, 0.32), lowLimb);
        // Sinking into the thick air at deep dusk, it dims and reddens.
        const duskA = mix(vec3(1.0), vec3(0.62, 0.36, 0.26), uDusk);
        const flare = uSunFlare.add(1.0);
        const radA = heartA.mul(darkA).mul(ember).mul(duskA).mul(SUN_A_POWER)
            .mul(flare);
        // A dust bar across the disc veils it to a deeper ember.
        const veiled = radA.mul(mix(vec3(1.0), vec3(0.42, 0.24, 0.16), barCover.mul(0.85)));
        col.assign(mix(col, veiled, discA));
        const cB = dot(dir, uSunB);
        const angB = sqrt(max(float(2.0).mul(float(1.0).sub(cB)), 0.0));
        const pxB = fwidth(angB).add(1e-6);
        const discB = float(1.0).sub(smoothstep(float(sunRadB).sub(pxB), float(sunRadB).add(pxB), angB));
        const muB = sqrt(max(float(1.0).sub(angB.div(sunRadB).pow(2.0)), 0.0));
        const darkB = vec3(1.0).sub(vec3(0.3, 0.45, 0.62).mul(float(1.0).sub(muB)));
        col.assign(mix(col, SUN_B_CORE.mul(darkB).mul(SUN_B_POWER).mul(flare), discB));
        // A tight corona just outside each disc: the ember's held close, the white sun's wider.
        const coronaA = exp(rA.sub(1.0).max(0.0).mul(-4.0)).mul(0.5).mul(float(1.0).sub(discA))
            .mul(float(1.0).sub(barCover.mul(0.7)));
        col.addAssign(uSunLightA.mul(coronaA));
        const coronaB = exp(angB.div(sunRadB).sub(1.0).max(0.0).mul(-2.6)).mul(1.2).mul(float(1.0).sub(discB));
        col.addAssign(uSunLightB.mul(coronaB));

        return vec4(col, 1.0);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-sky';
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // after the opaque world: early-z skips covered pixels
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return {
        mesh,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
