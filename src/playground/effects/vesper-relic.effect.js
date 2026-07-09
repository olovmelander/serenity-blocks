/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Vesper Chrysalis — the Relic-Heart (slice 2): the dormant crystalline egg.
 *
 * Two nested meshes:
 *   • CORE — an emissive amber sphere with molten FBM churn + a breathing pulse.
 *   • SHELL — a translucent dark-crystal egg: icy-cyan fresnel rim + procedural
 *     cracks that GROW and glow amber as the escalation scalar S rises
 *     (Dormant S=0 → smooth sleeping egg; Spill S≈0.6 → gaping molten fractures).
 *
 * Preview raw (playground = NoToneMapping). Port target:
 *   src/themes/vesper-chrysalis/rendering/relic-heart.js
 *
 *   ?effect=vesper-relic&t=4            dormant
 *   ?effect=vesper-relic&t=4&S=0.6      spill
 * Live sweep:  window.__VESPER_RELIC__.setS(0.6)
 */
import * as THREE from 'three/webgpu';
import {
    float, vec3, uniform, positionLocal, normalLocal, normalWorld, positionWorld, cameraPosition,
    normalize, dot, clamp, smoothstep, abs, mix, sin, pow,
    mx_fractal_noise_float, mx_noise_float,
} from 'three/tsl';

export const meta = {
    id: 'vesper-relic',
    title: 'Vesper Relic-Heart (geode egg)',
    description: 'Translucent crystal egg + molten core + cracks that grow with escalation S.',
};

const num = (p, k, d) => {
    const v = Number.parseFloat(p?.get?.(k));
    return Number.isFinite(v) ? v : d;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function create({ scene, params }) {
    const uTime = uniform(0);
    const uS = uniform(clamp01(num(params, 'S', 0)));

    scene.background = new THREE.Color(0x0a0716); // dark violet so the emissive reads

    const group = new THREE.Group();
    group.scale.set(1, 1.24, 1); // egg proportion
    scene.add(group);

    // Breathing pulse (0..1), independent of S; amplitude applied per-use.
    const pulse = sin(uTime.mul(1.1)).mul(0.5).add(0.5);

    // ── CORE: molten amber heart — dim & contained when dormant, flares with S ──
    const cAmberDeep = vec3(1.00, 0.30, 0.04);
    const cGold = vec3(1.00, 0.80, 0.38);
    const corePos = positionLocal.mul(2.8).add(vec3(0.0, uTime.mul(-0.28), 0.0));
    const churn = mx_fractal_noise_float(corePos, 4).mul(0.5).add(0.5);
    const coreEnergy = float(0.16).add(uS.mul(0.62)) // baseline glow rises with wakefulness
        .add(pulse.mul(uS.mul(0.5).add(0.10))); // breathing deepens as it wakes
    const coreCol = mix(cAmberDeep, cGold, pow(churn, float(1.5))).mul(coreEnergy);
    const coreMat = new THREE.MeshBasicNodeMaterial();
    coreMat.colorNode = coreCol;
    coreMat.toneMapped = false;
    const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 5), coreMat);
    group.add(coreMesh);

    // ── SHELL: translucent dark crystal — geode surface, sharp icy rim, cracks ──
    const cCrystal = vec3(0.055, 0.038, 0.135); // dark violet glass
    const cRim = vec3(0.55, 0.90, 1.00); // icy cyan edge
    const cCrack = vec3(1.00, 0.48, 0.12); // molten amber

    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(clamp(float(1.0).sub(dot(N, V)), 0.0, 1.0), float(3.4)); // crisp rim

    // Faint internal inclusions/fractures so the glass isn't a smooth blob.
    const inclusion = mx_noise_float(positionLocal.mul(4.5)).mul(0.5).add(0.5);

    // Crack field: FBM iso-lines on the shell surface. Width grows with S.
    const crackField = mx_fractal_noise_float(positionLocal.mul(1.7), 4).mul(0.5).add(0.5);
    const crackW = float(0.010).add(uS.mul(0.055)); // hairline → gaping
    const crackLine = smoothstep(crackW, float(0.0), abs(crackField.sub(0.5)));
    // Cracks only glow once the relic wakes (S>0); flicker a touch with the pulse.
    const crackGlow = crackLine.mul(uS).mul(pulse.mul(0.35).add(0.85));

    const shellMat = new THREE.MeshBasicNodeMaterial();
    shellMat.colorNode = cCrystal.mul(inclusion.mul(0.6).add(0.7))
        .add(cRim.mul(fres).mul(1.0))
        .add(cCrack.mul(crackGlow).mul(1.5));
    shellMat.opacityNode = clamp(
        float(0.05).add(inclusion.mul(0.05)).add(fres.mul(0.85)).add(crackGlow.mul(0.95)),
        float(0.0), float(1.0),
    );
    // Geode surface: push vertices out along their normals with low-freq noise → facets/lumps.
    const geodeDisp = mx_noise_float(positionLocal.mul(2.2)).mul(0.09);
    shellMat.positionNode = positionLocal.add(normalLocal.mul(geodeDisp));
    shellMat.transparent = true;
    shellMat.depthWrite = false;
    shellMat.side = THREE.FrontSide;
    shellMat.toneMapped = false;

    const shellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 5), shellMat);
    group.add(shellMesh);

    window.__VESPER_RELIC__ = {
        setS: (v) => { uS.value = clamp01(v); },
        getS: () => uS.value,
    };

    return {
        cameraRadius: 6.4,
        update(time) {
            uTime.value = time;
            group.rotation.y = time * 0.12;
        },
        dispose() {
            if (window.__VESPER_RELIC__) delete window.__VESPER_RELIC__;
            scene.background = null;
            scene.remove(group);
            coreMesh.geometry.dispose();
            coreMat.dispose();
            shellMesh.geometry.dispose();
            shellMat.dispose();
        },
    };
}
