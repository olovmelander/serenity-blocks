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
    Fn, Loop, float, vec2, vec3, vec4, uniform,
    mix, clamp, abs, fract, sin, cos, smoothstep, max, pow, exp, dot, atan2,
    normalize, positionWorld, cameraPosition,
} from 'three/tsl';

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

    // --- 2D rotation ---
    const rot = Fn(([p, a]) => {
        const c = cos(a);
        const s = sin(a);
        return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
    });

    // triangle wave, clamped away from the hard 0/0.5 cusps
    const tri = Fn(([x]) => clamp(abs(fract(x).sub(0.5)), 0.01, 0.49));

    // nimitz triNoise2d — layered, domain-warped triangle noise → curly veins
    const triNoise2d = Fn(([pIn, spd]) => {
        const t = uTime.mul(spd);
        const p = pIn.toVar();
        p.assign(rot(p, p.x.mul(0.06)));
        const bp = p.toVar();
        const z = float(1.8).toVar();
        const z2 = float(2.5).toVar();
        const rz = float(0.0).toVar();
        Loop(5, () => {
            const b2 = bp.mul(2.0);
            const dg = rot(
                vec2(tri(b2.x).add(tri(b2.y)), tri(b2.y.add(tri(b2.x)))).mul(0.8),
                t,
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
        const avgCol = vec4(0.0).toVar();
        const ry = max(rd.y, 0.012);
        Loop(STEPS, ({ i }) => {
            const fi = float(i);
            const pt = float(0.8).add(pow(fi, 1.4).mul(0.0045)).div(ry.mul(2.0).add(0.4));
            const bpos = rd.mul(pt);
            // Wind-drift the curtain field over time so it visibly flows across
            // the sky (not just shimmers in place).
            const drift = vec2(uTime.mul(driftSpeed), uTime.mul(driftSpeed.mul(0.25)));
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
    const sky = skyBase.add(skyLift);

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
    // Curtain density × pillars, tinted emerald(left) → teal(right), brighter left.
    const curtain = auro.a.mul(shafts);
    const hx = clamp(rd.x.mul(0.55).add(0.42), 0.0, 1.0);
    const emerald = vec3(0.10, 1.0, 0.38);
    const teal = vec3(0.14, 0.95, 0.80);
    const tint = mix(emerald, teal, hx);
    const leftWeight = mix(float(1.4), float(0.72), hx);
    const accentCol = vec3(uAccent.r, uAccent.g, uAccent.b);
    const tinted = mix(tint, accentCol, clamp(uFlare.mul(0.5), 0.0, 0.8));
    const auroraRGB = clamp(
        tinted.mul(curtain).mul(leftWeight).mul(auroraGain).mul(whiteoutFade)
            .mul(1.15),
        0.0,
        6.0,
    );

    // Luminous emerald ground-glow band above the ridgeline.
    const glowBand = smoothstep(0.0, 0.1, rd.y).mul(smoothstep(0.46, 0.08, rd.y));
    const baseGlow = vec3(0.12, 0.85, 0.55).mul(glowBand).mul(auroraGain).mul(whiteoutFade)
        .mul(0.3);

    const litColor = clamp(sky.add(moonGlow).add(auroraRGB).add(baseGlow), 0.0, 6.0);
    // Only the aurora + moon glow + base glow bloom — not the dark sky. Kept low so
    // the MRT bloom doesn't re-brighten what we just dialed down.
    const emissive = clamp(auroraRGB.add(moonGlow.mul(0.6)).add(baseGlow), 0.0, 6.0).mul(0.7);

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
            uTime, uIntensity, uFlare, uWhiteout, uAccent, uMoonDir,
        },
        dispose: () => {
            geometry.dispose();
            material.dispose();
        },
    };
}
