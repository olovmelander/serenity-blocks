/* eslint-disable import/no-unresolved */
/**
 * Winter AAA — Volumetric aurora sky dome (Phase 2, the hero).
 *
 * Replaces the previous 2D CanvasTexture bake with a real GPU/TSL raymarched
 * aurora authored entirely in a NodeMaterial colorNode + emissiveNode. The
 * curtains have volume, vertical rays, and a dancing fold structure (nimitz/iq
 * layered-slab march sampling a veiny triangle-noise field), plus a night-sky
 * gradient and a moon-direction glow so this single dome is the whole backdrop.
 *
 * Crucially the aurora is written to emissiveNode, so it survives the MRT path
 * and drives the post bloom (the canvas bake could not — that is why post shipped
 * with useMRT:false). Output is clamped + NaN-guarded to avoid the over-bright
 * white-sky fallback the canvas bake was working around.
 *
 * Keeps the EXACT uniform surface the theme drives per-frame:
 *   { uTime, uIntensity, uFlare, uWhiteout, uAccent, uMoonDir }
 * so winter-theme.js plumbing is unchanged. Prototyped + screenshot-verified as
 * src/playground/effects/winter-aurora.effect.js. See docs/WINTER_AAA_REVIEW_2026-06.md.
 */

import * as THREE from 'three/webgpu';
import {
    Fn, If, Loop, float, vec2, vec3, vec4, uniform,
    mix, clamp, abs, fract, sin, cos, smoothstep, max, pow, exp, dot, atan2,
    normalize, positionWorld, cameraPosition,
} from 'three/tsl';
import {
    TWILIGHT_DIR, WARM_HORIZON,
    AURORA_GREEN_WARM, AURORA_GREEN_COOL, AURORA_CRIMSON, AURORA_PINK, AURORA_VIOLET,
} from '../lighting/winter-light-rig.js';

export function createAuroraVolume(params = {}) {
    const radius = params.radius ?? 4500;
    // Preset-driven march depth (theme passes ~12..28). Clamp for safety.
    const STEPS = Math.max(10, Math.min(40, Math.round(params.steps ?? 26)));
    console.log(`%c[AuroraVolume] build: volumetric-tsl-v2-pillars (${STEPS} steps)`, 'color:#6ff2d6;font-weight:bold');

    const initialAccent = params.accent instanceof THREE.Color
        ? params.accent.clone()
        : new THREE.Color(params.accent ?? 0x6ff2d6);
    const moonDir = (params.moonDir instanceof THREE.Vector3
        ? params.moonDir.clone()
        : new THREE.Vector3(470, 330, -1050)).normalize();

    // Uniform surface — identical to the old canvas volume so the theme's
    // per-frame updates (winter-theme.js ~3163) keep working unchanged.
    const uTime = uniform(0);
    const uIntensity = uniform(0);
    const uFlare = uniform(0);
    const uWhiteout = uniform(0);
    const uAccent = uniform(initialAccent);
    const uMoonDir = uniform(moonDir);
    // Polar twilight (snowflow rebuild): direction + gain of the warm band the
    // sunk sun leaves behind the mountain line. 0 restores the pure night sky.
    const uTwilightDir = uniform(TWILIGHT_DIR.clone());
    const uTwilightGain = uniform(params.twilightGain ?? 1.0);
    // Far mountain chain painted INTO the sky (snowflow's far-range idea): peak
    // height above the horizon in rd.y units (~radians). 0 removes the chain.
    const uRidgeHeight = uniform(params.ridgeHeight ?? 0.135);

    // --- 2D rotation ---
    const rot = Fn(([p, a]) => {
        const c = cos(a);
        const s = sin(a);
        return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
    });

    // Rotation with PRE-COMPUTED cos/sin. The curtain's per-octave rotation
    // uses one angle that is constant for the whole call, but `rot()` recomputed
    // cos+sin on every one of the 5 octaves x 26 march steps = 130 redundant
    // trig pairs per pixel. Hoisting them is free and changes nothing visually.
    const rotCS = (p, c, s2) => vec2(p.x.mul(c).sub(p.y.mul(s2)), p.x.mul(s2).add(p.y.mul(c)));

    // triangle wave, clamped away from the hard 0/0.5 cusps
    const tri = Fn(([x]) => clamp(abs(fract(x).sub(0.5)), 0.01, 0.49));

    // nimitz triNoise2d — layered, domain-warped triangle noise → curly veins
    const triNoise2d = Fn(([pIn, spd]) => {
        const t = uTime.mul(spd);
        const ct = cos(t); // loop-invariant — see rotCS
        const st = sin(t);
        const p = pIn.toVar();
        p.assign(rot(p, p.x.mul(0.06)));
        const bp = p.toVar();
        const z = float(1.8).toVar();
        const z2 = float(2.5).toVar();
        const rz = float(0.0).toVar();
        Loop(5, () => {
            const b2 = bp.mul(2.0);
            const dg = rotCS(
                vec2(tri(b2.x).add(tri(b2.y)), tri(b2.y.add(tri(b2.x)))).mul(0.8),
                ct,
                st,
            ).toVar();
            p.subAssign(dg.div(z2));
            bp.mulAssign(1.6);
            z2.mulAssign(0.6);
            z.mulAssign(1.8);
            p.mulAssign(1.2);
            rz.addAssign(tri(p.x.add(tri(p.y))).div(z));
        });
        return rz;
    });

    // Constant curtain wind speed. Kept constant (not intensity-scaled) because
    // uTime grows unbounded — a varying multiplier would jump the phase.
    const driftSpeed = float(0.3);

    // Layered aurora march: intersect the ray with rising horizontal slabs and
    // accumulate the veiny field. ro at origin, rd the (normalized) view ray.
    const aurora = Fn(([rd]) => {
        const col = vec4(0.0).toVar();
        // BELOW-HORIZON GATE. The horizon clip at the end multiplies downward
        // rays to exactly zero, but they were still paying for the full march.
        // The dome is a FULL SPHERE drawn before everything with depthWrite
        // off, so there is no early-z rejection: roughly half of every frame's
        // dome pixels ran 26 x 5 noise iterations to produce black. Measured at
        // ~76% of total GPU frame cost before this gate.
        If(rd.y.greaterThan(-0.006), () => {
            const avgCol = vec4(0.0).toVar();
            const ry = max(rd.y, 0.012);
            // Loop-invariant: same value on all 26 steps.
            const drift = vec2(uTime.mul(driftSpeed), uTime.mul(driftSpeed.mul(0.25)));
            Loop(STEPS, ({ i }) => {
                const fi = float(i);
                const pt = float(0.8).add(pow(fi, 1.4).mul(0.0045)).div(ry.mul(2.0).add(0.4));
                const bpos = rd.mul(pt);
                const samplePos = bpos.zx.mul(4.5).add(drift);
                const raw = triNoise2d(samplePos, 0.14);
                // Subtract a haze floor → dark cobalt sky between sharp pillars.
                const rzt = pow(clamp(raw.sub(0.16).mul(1.5), 0.0, 1.0), float(2.6));
                // Per-layer hue cycle (green → teal → violet) à la nimitz.
                const rgbBase = vec3(2.15, -0.5, 1.2).negate().add(1.0).add(fi.mul(0.043))
                    .sin()
                    .mul(0.5)
                    .add(0.5);
                const col2 = vec4(rgbBase.mul(rzt), rzt);
                avgCol.assign(mix(avgCol, col2, 0.5));
                const fade = exp(fi.mul(-0.05).sub(1.5)).mul(smoothstep(0.0, 2.0, fi));
                col.addAssign(avgCol.mul(fade));
            });
        });
        // Horizon clip: aurora only above the skyline, soft edge.
        col.mulAssign(clamp(rd.y.mul(18.0).add(0.1), 0.0, 1.0));
        return col.mul(2.0);
    });

    // --- View ray from the camera through this dome fragment ---
    const rd = normalize(positionWorld.sub(cameraPosition));

    // Storm-driven gains. Aurora reads at idle (intensity floor ~0.12) and
    // ramps with the storm; flare brightens + pushes toward the combo accent;
    // whiteout washes the curtains out toward a pale storm sky.
    const intensity01 = clamp(uIntensity, 0.0, 1.5);
    // Mid brightness — visible above the ridgeline without blowing out.
    const auroraGain = float(0.85).add(intensity01.mul(0.45)).mul(float(1.0).add(uFlare.mul(0.3)));
    const whiteoutFade = float(1.0).sub(clamp(uWhiteout.mul(0.5), 0.0, 0.5));

    // Darker cobalt night gradient — a deep winter night, aurora/moon as the light.
    const nightTop = vec3(0.012, 0.03, 0.10);
    const nightHorizon = vec3(0.03, 0.075, 0.18);
    const skyBase = mix(nightHorizon, nightTop, clamp(rd.y, 0.0, 1.0));
    const skyLift = vec3(0.45, 0.54, 0.66).mul(clamp(uWhiteout, 0.0, 1.0).mul(0.32));
    // Polar-twilight band: the warm glow the sunk sun leaves along its azimuth,
    // hugging the horizon behind the peaks. Manual xz normalize with a floor —
    // a zenith ray has a zero-length xz and WGSL rejects normalizing it.
    const rdXZ = vec2(rd.x, rd.z);
    const twiXZ = vec2(uTwilightDir.x, uTwilightDir.z);
    const along = clamp(
        rdXZ.dot(twiXZ).div(rdXZ.length().mul(twiXZ.length()).max(1e-4)),
        0.0,
        1.0,
    );
    const yUp = clamp(rd.y, 0.0, 1.0);
    const warmBand = vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b)
        .mul(pow(along, 3.0)).mul(exp(yUp.mul(-9.0))).mul(0.85)
        .add(vec3(0.42, 0.20, 0.10).mul(pow(along, 1.5)).mul(exp(yUp.mul(-5.5))).mul(0.35))
        .mul(uTwilightGain);
    const skyOpen = skyBase.add(skyLift).add(warmBand);

    // ── Far mountain chain, painted into the sky (no geometry) ──────────────
    // Two layered silhouette ridgelines just above the horizon. The ridge
    // profile is triangle-wave FBM over the view azimuth with INTEGER cycle
    // counts, so it tiles seamlessly around the full horizon; the atan2 seam is
    // rotated to +z, behind the camera. Feet dissolve into the same haze band
    // the ground fog resolves to, so field, chain and sky meet at one colour.
    const azR = atan2(rd.x, rd.z.negate()).mul(0.15915494309); // cycles, seam behind camera
    const ridgeOct = (f, ph) => tri(azR.mul(f).add(ph)).mul(2.04);
    const hazeBand = vec3(0.17, 0.30, 0.52)
        .add(vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b).mul(pow(along, 2.0)).mul(0.20));

    // Back layer: the high blue chain. Broad octave weighted up for bulky
    // massifs; the slow amplitude modulation keeps a high floor so the chain
    // stays continuously massive around the horizon instead of dipping away.
    const r1 = ridgeOct(3.0, 0.13).mul(0.58)
        .add(ridgeOct(7.0, 0.47).mul(0.27))
        .add(ridgeOct(16.0, 0.79).mul(0.15));
    const amp1 = ridgeOct(1.0, 0.31).mul(0.35).add(0.68);
    const yR1 = float(0.02).add(r1.mul(amp1).mul(uRidgeHeight));
    const m1 = smoothstep(yR1.add(0.0025), yR1.sub(0.0025), rd.y);
    const alpenRim1 = vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b)
        .mul(pow(along, 2.5)).mul(smoothstep(yR1.sub(0.028), yR1, rd.y)).mul(0.5);
    const tone1 = mix(vec3(0.10, 0.155, 0.29), hazeBand, smoothstep(0.09, 0.0, yUp))
        .add(alpenRim1);

    // Front layer: lower, slightly darker foothill ridge.
    const r2 = ridgeOct(5.0, 0.61).mul(0.5)
        .add(ridgeOct(11.0, 0.23).mul(0.3))
        .add(ridgeOct(23.0, 0.91).mul(0.2));
    const amp2 = ridgeOct(1.0, 0.77).mul(0.4).add(0.6);
    const yR2 = float(0.009).add(r2.mul(amp2).mul(uRidgeHeight).mul(0.5));
    const m2 = smoothstep(yR2.add(0.002), yR2.sub(0.002), rd.y);
    const tone2 = mix(vec3(0.078, 0.118, 0.23), hazeBand, smoothstep(0.05, 0.0, yUp))
        .add(alpenRim1.mul(0.35));

    const sky = mix(mix(skyOpen, tone1, m1), tone2, m2);

    // Moon-direction glow (replaces the canvas radial moon glow).
    const moonCos = clamp(dot(rd, normalize(uMoonDir)), 0.0, 1.0);
    const moonGlow = vec3(0.24, 0.38, 0.62).mul(pow(moonCos, float(72.0)).mul(0.5))
        .add(vec3(0.08, 0.13, 0.24).mul(pow(moonCos, float(10.0)).mul(0.12)));

    const auro = aurora(rd);
    // Vertical PILLAR mask: irregular drifting shafts from the horizontal view
    // angle → straight vertical light pillars carved into the curtain band.
    const az = atan2(rd.x, rd.z);
    const s1 = sin(az.mul(16.0).add(uTime.mul(0.14)));
    const s2 = sin(az.mul(33.0).sub(uTime.mul(0.09)));
    const s3 = sin(az.mul(6.0).add(1.7));
    const shaftRaw = s1.mul(0.5).add(s2.mul(0.3)).add(s3.mul(0.2)).mul(0.5)
        .add(0.5);
    const shafts = float(0.26).add(pow(shaftRaw, float(2.6)));
    const curtain = auro.a.mul(shafts);
    const hx = clamp(rd.x.mul(0.55).add(0.42), 0.0, 1.0);
    const leftWeight = mix(float(1.4), float(0.72), hx);

    // ── Aurora colour by ALTITUDE (the real physics) ────────────────────────
    // A real aurora's colour is not a hue cycle, it is a map of WHICH GAS is
    // glowing at WHICH HEIGHT, so the display is naturally stacked in bands:
    //
    //   ~90-100 km   molecular nitrogen  → pink / magenta lower fringe
    //   ~100-150 km  atomic oxygen 557.7 → the classic green body
    //   ~200-400 km  atomic oxygen 630.0 → deep red crown (a slow transition
    //                that only survives where the air is too thin to quench it)
    //   low + hard   ionised N2+ 427.8   → blue-violet, energetic events only
    //
    // So the sky reads bottom-to-top violet → pink → green → crimson, and the
    // upper and lower fringes only appear as activity climbs. That is the whole
    // trick: quiet nights are green, storms bloom a red crown and a pink hem.
    const altN = clamp(rd.y.mul(1.85), 0.0, 1.0);

    // ACTIVITY drifts slowly (periods ~3 and ~5 minutes) so the display keeps
    // evolving on its own, and the storm/combo intensity rides on top — a big
    // clear literally energises the sky into its red-crown state.
    // Calibrated against the REAL idle baseline: uIntensity never reaches 0 —
    // the theme rests it around 0.62-0.69 — so feeding it raw kept `activity`
    // near 0.83 and the red crown permanently lit. Only the EXCESS over that
    // resting level counts as a storm, which is what makes the crown an event.
    const activity = clamp(
        float(0.06)
            .add(sin(uTime.mul(0.035)).mul(0.18))
            .add(sin(uTime.mul(0.0213).add(1.3)).mul(0.14))
            .add(max(intensity01.sub(0.62), 0.0).mul(0.9))
            .add(uFlare.mul(0.5)),
        0.0,
        1.35,
    );

    // The green body itself breathes between a warm yellow-green and a cool
    // teal-green on a ~2 minute cycle, so even a quiet sky is never static.
    const greenBody = mix(
        vec3(AURORA_GREEN_WARM.r, AURORA_GREEN_WARM.g, AURORA_GREEN_WARM.b),
        vec3(AURORA_GREEN_COOL.r, AURORA_GREEN_COOL.g, AURORA_GREEN_COOL.b),
        sin(uTime.mul(0.047)).mul(0.5).add(0.5),
    );
    const crimsonCrown = vec3(AURORA_CRIMSON.r, AURORA_CRIMSON.g, AURORA_CRIMSON.b);
    const pinkFringe = vec3(AURORA_PINK.r, AURORA_PINK.g, AURORA_PINK.b);
    const violetBase = vec3(AURORA_VIOLET.r, AURORA_VIOLET.g, AURORA_VIOLET.b);

    // Masks. NOTE: smoothstep(lo, hi, x).oneMinus() — never smoothstep(hi, lo, x),
    // which silently evaluates to 0 in TSL (documented repo trap).
    // Crown weighted up hard (user call, 3rd pass): DEEPER hue (see
    // AURORA_CRIMSON), reaching far lower down the sky (0.26 vs 0.52 originally),
    // saturating by 0.70, lit from a lower activity, and now mixed at FULL
    // opacity so the crimson genuinely replaces the green up top rather than
    // tinting it. The green survives as the mid/low body.
    const crownMask = smoothstep(0.26, 0.70, altN).mul(clamp(activity.sub(0.10).mul(2.1), 0.0, 1.0));
    const fringeMask = smoothstep(0.0, 0.17, altN).oneMinus()
        .mul(clamp(activity.sub(0.34).mul(1.7), 0.0, 1.0));
    const violetMask = smoothstep(0.0, 0.10, altN).oneMinus()
        .mul(clamp(activity.sub(0.72).mul(2.4), 0.0, 1.0));

    // Green → crimson must never AVERAGE: a linear RGB lerp between green and
    // red passes through olive — the residual "still a bit yellow" band, and it
    // got wider when the crown was pushed lower + fully opaque. Real bands are
    // distinct emissions with a darker seam between them, so: an S-curve on the
    // mix squeezes the blend zone into a thin seam, and a sin-shaped dip dims
    // that seam ~40% — the eye reads "green ends, crimson begins" across dark
    // sky instead of a mustard gradient.
    const crownX = smoothstep(0.18, 0.82, crownMask);
    const bandDip = float(1.0).sub(sin(crownX.mul(3.14159265)).mul(0.42));
    const tint = mix(
        mix(mix(greenBody, crimsonCrown, crownX).mul(bandDip), pinkFringe, fringeMask.mul(0.85)),
        violetBase,
        violetMask.mul(0.7),
    );
    const accentCol = vec3(uAccent.r, uAccent.g, uAccent.b);
    const tinted = mix(tint, accentCol, clamp(uFlare.mul(0.5), 0.0, 0.8));
    const auroraRGB = clamp(
        tinted.mul(curtain).mul(leftWeight).mul(auroraGain).mul(whiteoutFade)
            .mul(1.15),
        0.0,
        6.0,
    );

    // Luminous emerald ground-glow band above the ridgeline.
    // NOTE: the outer fade was written `smoothstep(0.46, 0.08, rd.y)` — reversed
    // edges, which TSL evaluates to a constant 0, so this whole band has been
    // multiplied away and never rendered. Rewritten in the safe
    // `smoothstep(lo, hi, x).oneMinus()` form, and tinted from the same
    // altitude palette so the horizon glow matches the curtains above it.
    const glowBand = smoothstep(0.0, 0.1, rd.y).mul(smoothstep(0.08, 0.46, rd.y).oneMinus());
    const baseGlow = mix(greenBody, pinkFringe, fringeMask.mul(0.7))
        .mul(glowBand).mul(auroraGain).mul(whiteoutFade)
        .mul(0.26);

    const litColor = clamp(sky.add(moonGlow).add(auroraRGB).add(baseGlow), 0.0, 6.0);
    // Only the aurora + moon glow + base glow bloom — not the dark sky. Kept low so
    // the MRT bloom doesn't re-brighten what we just dialed down.
    const emissive = clamp(
        auroraRGB.add(moonGlow.mul(0.6)).add(baseGlow).add(warmBand.mul(0.25)),
        0.0,
        6.0,
    ).mul(0.7);

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
    });
    material.colorNode = litColor;
    material.emissiveNode = emissive;

    const geometry = new THREE.SphereGeometry(radius, 64, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms: {
            uTime,
            uIntensity,
            uFlare,
            uWhiteout,
            uAccent,
            uMoonDir,
            uTwilightDir,
            uTwilightGain,
            uRidgeHeight,
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}
