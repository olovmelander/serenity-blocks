/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Aurora Band (the restrained "whisper")
 *
 * A thin, gentle aurora ribbon in the UPPER sky only — a magical accent, NOT the
 * full flowing curtains of the dedicated Aurora theme (that's the differentiation
 * guardrail). Lives above the board so it never washes out gameplay, is
 * luminance-capped, additive, and `emitsBloom=false` (ambient, not a bloom hero).
 * High/Ultra/Extreme only; it's the first layer dropped on lower tiers.
 *
 * Technique: an inverted sky-sphere (just inside the nebula) whose additive
 * colorNode paints slowly-drifting horizontal ribbons × finer vertical curtain
 * streaks, masked to an upper-elevation band, tinted cyan-green → lavender.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    float,
    min,
    mix,
    normalize,
    positionWorld,
    smoothstep,
    uniform,
    vec3,
} from 'three/tsl';
import { fbm3 } from '../materials/tsl-noise-lib.js';

export function createAuroraBand(options = {}) {
    const geometry = new THREE.SphereGeometry(170, 24, 16);

    const uTime = uniform(0);
    const baseStrength = options.strength ?? 0.45;
    const uStrength = uniform(baseStrength);

    // Event "surge": briefly raises the aurora's strength then linearly eases
    // back (big-moment magic — combo 10+, perfect clear, level up).
    let surgeVal = 0;
    let surgePeak = 0;
    let surgeDur = 1;
    let lastTime = 0;

    const C_LOW = vec3(0.10, 0.40, 0.38); // soft cyan-teal (desaturated)
    const C_HIGH = vec3(0.30, 0.26, 0.50); // soft lavender

    const colorNode = Fn(() => {
        const dir = normalize(positionWorld).toVar();
        const elev = dir.y.toVar();

        // High, soft band with WIDE feathered falloff — so wisps fade gently
        // instead of being clipped flat into glowing rectangles.
        const band = smoothstep(0.25, 0.6, elev).mul(smoothstep(0.62, 1.05, elev).oneMinus()).toVar();

        // FINE vertical curtains: horizontal-varying noise (thin streaks, not big
        // blobs), sparse threshold, slow drift.
        const cur = fbm3(vec3(dir.x.mul(5.5).add(uTime.mul(0.02)), dir.z.mul(5.5), float(3.0)));
        const curtain = smoothstep(0.5, 0.92, cur);

        // Vertical filament shimmer (the "moving light" of an aurora).
        const shimmer = fbm3(vec3(dir.x.mul(11.0), elev.mul(6.0).add(uTime.mul(0.05)), dir.z.mul(11.0)));
        const fil = float(0.45).add(shimmer.mul(0.55));

        const intensity = band.mul(curtain).mul(fil);
        const aur = mix(C_LOW, C_HIGH, smoothstep(0.3, 0.6, elev));
        const outc = aur.mul(intensity).mul(uStrength);

        // Much dimmer cap — a faint ethereal whisper, never glowing boxes.
        return min(outc, vec3(0.06));
    })();

    const material = new MeshBasicNodeMaterial({
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
    });
    material.colorNode = colorNode;
    material.emissiveNode = vec3(0.0); // ambient — NOT bloom-eligible
    material.userData.emitsBloom = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -950; // over the nebula, behind the stars
    mesh.frustumCulled = false;

    return {
        mesh,
        uniforms: { uTime, uStrength },
        update(time) {
            const dt = lastTime ? Math.max(0, time - lastTime) : 0;
            lastTime = time;
            if (surgeVal > 0.0001 && surgeDur > 0) {
                surgeVal = Math.max(0, surgeVal - (dt / surgeDur) * surgePeak);
            }
            uTime.value = time;
            uStrength.value = baseStrength + surgeVal;
        },
        /** Briefly brighten the aurora (amount added to strength), easing back over durationMs. */
        surge(amount = 0.5, durationMs = 1200) {
            surgePeak = amount;
            surgeVal = amount;
            surgeDur = Math.max(0.1, durationMs / 1000);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
