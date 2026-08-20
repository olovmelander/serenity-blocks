/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Winter Aurora — raymarched volumetric northern lights.
 *
 * The "hero" effect the WINTER_AAA_PLAN called for but never landed: instead of a
 * flat noise plane (or the shipped 2D-canvas fallback), this marches layered
 * horizontal slabs along the view ray and samples a veiny triangle-noise field
 * (nimitz/iq aurora), so the curtains have real volume, vertical rays, and a
 * dancing fold structure. Front-to-back accumulation with a height/horizon
 * falloff; output is clamped + NaN-guarded to avoid the over-bright white sky
 * that pushed the original to a canvas painting.
 *
 * Tunables (URL params): ?intensity ?scale ?steps ?accent (hex, no #)
 *
 * Port target once proven: src/themes/winter/rendering/aurora-volume.js
 *   (replace the CanvasTexture sky-shell aurora) + retire the flat-plane
 *   createAuroraSystem() curtains in winter-theme.js.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, float, vec2, vec3, vec4, uniform,
    mix, clamp, abs, fract, sin, cos, smoothstep, max, pow, exp, dot, atan,
    normalize, positionWorld, cameraPosition,
} from 'three/tsl';

export const meta = {
    id: 'winter-aurora',
    title: 'Winter Aurora (volumetric)',
    description: 'Raymarched layered northern lights — the winter sky hero.',
};

export function create({ scene, params }) {
    const STEPS = Math.max(16, Math.min(64, parseInt(params?.get('steps') ?? '42', 10) || 42));
    const accentHex = params?.get('accent');
    const initialAccent = accentHex ? new THREE.Color(`#${accentHex}`) : new THREE.Color(0xff7ce0);

    const uTime = uniform(0);
    const uIntensity = uniform(parseFloat(params?.get('intensity') ?? '1') || 1);
    const uScale = uniform(parseFloat(params?.get('scale') ?? '1') || 1);
    const uFlare = uniform(0); // 0..1.2 storm flare → pushes curtains toward accent
    const uAccent = uniform(initialAccent);

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
        // Guard rd.y so near-horizon rays don't blow the plane intersection up.
        const ry = max(rd.y, 0.012);
        Loop(STEPS, ({ i }) => {
            const fi = float(i);
            // Plane param climbs with i^1.4 so layers crowd toward the base.
            const pt = float(0.8).add(pow(fi, 1.4).mul(0.0045)).div(ry.mul(2.0).add(0.4));
            const bpos = rd.mul(pt);
            // Wind-drift the curtain field over time so it visibly flows across
            // the sky (not just shimmers in place), faster with the storm.
            const drift = vec2(uTime.mul(driftSpeed), uTime.mul(driftSpeed.mul(0.25)));
            const samplePos = bpos.zx.mul(uScale.mul(4.5)).add(drift);
            // Sharpen the veins → crisp curtains with dark gaps between.
            const raw = triNoise2d(samplePos, 0.14);
            // Subtract a haze floor → dark cobalt sky between bright sparse
            // pillars (higher floor + power = sharper, more distinct shafts).
            const rzt = pow(clamp(raw.sub(0.16).mul(1.5), 0.0, 1.0), float(2.6));
            // Per-layer hue cycle (green → teal → violet) à la nimitz.
            const rgbBase = vec3(2.15, -0.5, 1.2).negate().add(1.0).add(fi.mul(0.043))
                .sin()
                .mul(0.5)
                .add(0.5);
            const col2 = vec4(rgbBase.mul(rzt), rzt);
            avgCol.assign(mix(avgCol, col2, 0.5));
            // Keep the green low layers (only the first ~2 are eased in).
            const fade = exp(fi.mul(-0.05).sub(1.5)).mul(smoothstep(0.0, 2.0, fi));
            col.addAssign(avgCol.mul(fade));
        });
        // Horizon clip: aurora only above the skyline, soft edge.
        col.mulAssign(clamp(rd.y.mul(18.0).add(0.1), 0.0, 1.0));
        return col.mul(2.0);
    });

    // --- Sky dome ---
    const rd = normalize(positionWorld.sub(cameraPosition));

    // Cobalt night gradient matching the painted reference (luminous royal
    // blue, NOT near-black) — darker zenith, brighter toward the horizon.
    const nightTop = vec3(0.02, 0.05, 0.16);
    const nightHorizon = vec3(0.05, 0.12, 0.30);
    const sky = mix(nightHorizon, nightTop, clamp(rd.y, 0.0, 1.0));

    const auro = aurora(rd);
    // Vertical PILLAR mask: irregular drifting shafts as a function of the
    // horizontal view angle only → straight vertical light pillars (the painted
    // reference look) that we carve into the soft curtain band.
    const az = atan(rd.x, rd.z);
    const s1 = sin(az.mul(16.0).add(uTime.mul(0.14)));
    const s2 = sin(az.mul(33.0).sub(uTime.mul(0.09)));
    const s3 = sin(az.mul(6.0).add(1.7));
    const shaftRaw = s1.mul(0.5).add(s2.mul(0.3)).add(s3.mul(0.2)).mul(0.5)
        .add(0.5);
    const shafts = float(0.26).add(pow(shaftRaw, float(2.6)));
    // Stylized reference grade: use the curtain DENSITY (× pillar mask) as
    // luminance and tint it with a horizontal emerald(left) → teal(right)
    // gradient, brighter left — the reference is far more saturated than real.
    const curtain = auro.a.mul(shafts);
    const hx = clamp(rd.x.mul(0.55).add(0.42), 0.0, 1.0);
    const emerald = vec3(0.10, 1.0, 0.38);
    const teal = vec3(0.14, 0.95, 0.80);
    const tint = mix(emerald, teal, hx);
    const leftWeight = mix(float(1.4), float(0.72), hx);
    // Push hue toward the storm accent as flare rises (combo/tetris colour).
    const accentCol = vec3(uAccent.r, uAccent.g, uAccent.b);
    const tinted = mix(tint, accentCol, clamp(uFlare.mul(0.5), 0.0, 0.8));
    const auroraRGB = clamp(tinted.mul(curtain).mul(leftWeight).mul(uIntensity).mul(1.3), 0.0, 6.0);

    // Luminous emerald ground-glow band low in the sky — the bright base edge
    // the aurora throws above the ridgeline.
    const glowBand = smoothstep(0.0, 0.1, rd.y).mul(smoothstep(0.46, 0.08, rd.y));
    const baseGlow = vec3(0.12, 0.85, 0.55).mul(glowBand).mul(uIntensity).mul(0.5);

    const finalColor = clamp(sky.add(auroraRGB).add(baseGlow), 0.0, 6.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    // Feed only the aurora into bloom (not the dark sky) for the glow.
    material.emissiveNode = auroraRGB.mul(0.85);
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.fog = false;
    // Playground has no ACES pass; preview the raw graded values directly.
    material.toneMapped = false;

    const geometry = new THREE.SphereGeometry(4000, 64, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    let flarePulse = 0;
    return {
        cameraRadius: 0.001, // camera at the centre of the dome
        camera(time, camera) {
            // Slow drift, looking forward + ~20° up so the aurora arcs overhead.
            camera.position.set(0, 0, 0);
            const yaw = Math.sin(time * 0.04) * 0.35;
            // Look toward the horizon (~7° up) so the layered slabs spread into
            // tall vertical curtains rising from the skyline.
            camera.lookAt(Math.sin(yaw), 0.18, Math.cos(yaw));
        },
        update(time) {
            uTime.value = time;
            // Gentle breathing flare so the accent push is visible while iterating.
            flarePulse = 0.5 + 0.5 * Math.sin(time * 0.25);
            uFlare.value = flarePulse * 0.6;
        },
        dispose() {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
        },
    };
}
